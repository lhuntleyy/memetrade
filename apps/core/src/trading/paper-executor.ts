import { RateLimiter, type TradeConfig, toNum } from "@memebot/shared";
import type { SolanaRpc } from "@memebot/solana";
import type { ApiUsageFn } from "../collectors/dexscreener.ts";

/**
 * Paper executor realistis (docs/05 §4):
 *  - tunda sebesar latency, lalu ambil QUOTE JUPITER SWAP V2 beneran untuk jumlah persis (harga, impact, fee platform)
 *  - kalau quote gagal → estimasi lokal dari harga pasar + likuiditas (constant product) + fee konservatif
 *  - potong biaya jaringan (base + priority + tip) dan rent ATA (dikembalikan saat posisi habis kalau close_ata)
 *  - simulasi transaksi gagal dengan probabilitas p_fail
 */

export const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS = 1_000_000_000;
const BASE_FEE_LAMPORTS = 5000;
export const ATA_RENT_SOL = 0.00203928;
/** fee pool konservatif kalau tidak ada quote (pump curve ±1%, AMM ±0.3%) */
const FALLBACK_POOL_FEE_PCT = 1.0;
const FALLBACK_PLATFORM_FEE_PCT = 0.5;

export interface MarketView {
  /** SOL per token (UI) */
  priceSol: number;
  liquidityUsd: number | null;
  priceUsd: number | null;
}

export interface FillResult {
  ok: boolean;
  error?: string;
  route: "jupiter_quote" | "local_estimate";
  /** token (UI) yang diterima (buy) atau dijual (sell) */
  tokens: number;
  /** SOL keluar (buy, termasuk semua biaya) atau SOL masuk bersih (sell) */
  sol: number;
  /** harga eksekusi SOL/token sebelum biaya jaringan */
  execPrice: number;
  networkFeeSol: number;
  platformFeeBps: number;
  priceImpactPct: number | null;
  rentDeltaSol: number;
  quoteOut: string | null;
  latencyMs: number;
}

interface JupOrder {
  outAmount?: string;
  priceImpactPct?: string;
  feeBps?: number;
  router?: string;
  error?: string;
  errorMessage?: string;
}

export class PaperExecutor {
  /**
   * Key Jupiter (free) ≈ 1 req/dtk dibagi SEMUA endpoint (diukur 2026-10-17: jendela 10 req).
   * Anggaran quote (entry, monitoring posisi, fill exit) diatur trade.execution.quote_monitor.budget_per_min;
   * adapter tokens memakai sisa ±15/menit.
   */
  private quoteLimiter: RateLimiter;
  private quotePausedUntil = 0;
  quoteStats = { ok: 0, failed: 0, rateLimited: 0 };
  private decimals = new Map<string, number>();

  constructor(
    private readonly cfg: () => TradeConfig,
    private readonly rpc: SolanaRpc,
    private readonly market: (mint: string) => MarketView | null,
    private readonly onUsage: ApiUsageFn = () => {},
    private readonly random: () => number = Math.random,
  ) {
    this.quoteLimiter = new RateLimiter(cfg().execution.quote_monitor.budget_per_min, 4);
  }

  private async tokenDecimals(mint: string): Promise<number> {
    const c = this.decimals.get(mint);
    if (c !== undefined) return c;
    const acc = await this.rpc.getMint(mint);
    const d = acc?.info.decimals ?? 6;
    this.decimals.set(mint, d);
    return d;
  }

  private async quote(inputMint: string, outputMint: string, amountRaw: bigint): Promise<JupOrder | null> {
    const key = process.env.JUPITER_API_KEY;
    if (!key || amountRaw <= 0n) return null;
    if (Date.now() < this.quotePausedUntil) await Bun.sleep(this.quotePausedUntil - Date.now());
    await this.quoteLimiter.take();
    const t0 = performance.now();
    let status = 0;
    try {
      const url = `https://api.jup.ag/swap/v2/order?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}`;
      const res = await fetch(url, { headers: { "x-api-key": key }, signal: AbortSignal.timeout(6000) });
      status = res.status;
      if (res.status === 429) {
        this.quoteStats.rateLimited++;
        this.quotePausedUntil = Date.now() + 3000;
        return null;
      }
      if (!res.ok) {
        this.quoteStats.failed++;
        return null;
      }
      const body = (await res.json()) as JupOrder;
      if (!body.outAmount || body.error) {
        this.quoteStats.failed++;
        return null;
      }
      this.quoteStats.ok++;
      return body;
    } catch {
      this.quoteStats.failed++;
      return null;
    } finally {
      this.onUsage("jupiter", "swap_v2_order_quote", status, Math.round(performance.now() - t0));
    }
  }

  private networkFeeSol(side: "entry" | "exit", panic: boolean): number {
    const e = this.cfg().execution;
    let prio = side === "entry" ? e.priority_fee_lamports.entry : e.priority_fee_lamports.exit;
    if (panic) prio = Math.min(e.priority_fee_lamports.panic_max, prio * 3);
    const tip = side === "entry" ? e.tip_lamports.entry : e.tip_lamports.exit;
    return (BASE_FEE_LAMPORTS + prio + tip) / LAMPORTS;
  }

  private localImpactPct(sizeSol: number, m: MarketView): number {
    // constant product: impact ≈ dx / (y + dx), y = sisi SOL pool ≈ likuiditas/2
    if (!m.liquidityUsd || !m.priceUsd || m.priceUsd <= 0) return 3; // tanpa data likuiditas → asumsi 3%
    const solPerUsd = m.priceSol / m.priceUsd;
    const ySol = (m.liquidityUsd / 2) * solPerUsd;
    return ySol > 0 ? (sizeSol / (ySol + sizeSol)) * 100 : 3;
  }

  /** @param maxImpactPct entry ditolak kalau price impact quote melebihi ini (config profile entry.max_price_impact_pct) */
  async buy(mint: string, sizeSol: number, maxImpactPct = Number.POSITIVE_INFINITY): Promise<FillResult> {
    const t0 = performance.now();
    const p = this.cfg().paper;
    await Bun.sleep(p.latency_ms);
    const base = {
      tokens: 0,
      sol: 0,
      execPrice: 0,
      networkFeeSol: 0,
      platformFeeBps: 0,
      priceImpactPct: null,
      rentDeltaSol: 0,
      quoteOut: null,
    };
    if (this.random() < p.p_fail_entry)
      return {
        ...base,
        ok: false,
        error: "simulated_tx_fail",
        route: "local_estimate",
        latencyMs: Math.round(performance.now() - t0),
      };

    const decimals = await this.tokenDecimals(mint);
    const lamportsIn = BigInt(Math.round(sizeSol * LAMPORTS));
    const q = await this.quote(SOL_MINT, mint, lamportsIn);
    const network = this.networkFeeSol("entry", false);
    const rent = ATA_RENT_SOL;
    let tokens: number;
    let route: FillResult["route"];
    let feeBps: number;
    let impact: number | null;
    if (q?.outAmount) {
      tokens = Number(q.outAmount) / 10 ** decimals;
      route = "jupiter_quote";
      feeBps = q.feeBps ?? 0;
      impact = toNum(q.priceImpactPct) !== null ? Number(q.priceImpactPct) * 100 : null;
    } else {
      const m = this.market(mint);
      if (!m || !(m.priceSol > 0))
        return {
          ...base,
          ok: false,
          error: "no_price",
          route: "local_estimate",
          latencyMs: Math.round(performance.now() - t0),
        };
      impact = this.localImpactPct(sizeSol, m);
      const costPct = impact + FALLBACK_POOL_FEE_PCT + FALLBACK_PLATFORM_FEE_PCT;
      tokens = (sizeSol / m.priceSol) * (1 - costPct / 100);
      route = "local_estimate";
      feeBps = FALLBACK_PLATFORM_FEE_PCT * 100;
    }
    if (!(tokens > 0))
      return { ...base, ok: false, error: "zero_out", route, latencyMs: Math.round(performance.now() - t0) };
    // quote token baru sering liar (impact >100%) → tolak entry kalau di atas batas profile
    if (impact !== null && Math.abs(impact) > maxImpactPct)
      return {
        ...base,
        ok: false,
        error: `price_impact_${impact.toFixed(1)}pct`,
        route,
        priceImpactPct: impact,
        latencyMs: Math.round(performance.now() - t0),
      };
    return {
      ok: true,
      route,
      tokens,
      sol: sizeSol + network + rent,
      execPrice: sizeSol / tokens,
      networkFeeSol: network,
      platformFeeBps: feeBps,
      priceImpactPct: impact,
      rentDeltaSol: -rent,
      quoteOut: q?.outAmount ?? null,
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  /** @param closesPosition true kalau ini penjualan terakhir (rent ATA kembali kalau close_ata_after_exit) */
  async sell(
    mint: string,
    tokens: number,
    opts: { panic: boolean; closesPosition: boolean },
  ): Promise<FillResult> {
    const t0 = performance.now();
    const cfg = this.cfg();
    await Bun.sleep(cfg.paper.latency_ms);
    const base = {
      tokens: 0,
      sol: 0,
      execPrice: 0,
      networkFeeSol: 0,
      platformFeeBps: 0,
      priceImpactPct: null,
      rentDeltaSol: 0,
      quoteOut: null,
    };
    if (this.random() < cfg.paper.p_fail_exit)
      return {
        ...base,
        ok: false,
        error: "simulated_tx_fail",
        route: "local_estimate",
        latencyMs: Math.round(performance.now() - t0),
      };

    const decimals = await this.tokenDecimals(mint);
    const raw = BigInt(Math.floor(tokens * 10 ** decimals));
    const q = await this.quote(mint, SOL_MINT, raw);
    const network = this.networkFeeSol("exit", opts.panic);
    const rent = opts.closesPosition && cfg.execution.close_ata_after_exit ? ATA_RENT_SOL : 0;
    let gross: number;
    let route: FillResult["route"];
    let feeBps: number;
    let impact: number | null;
    if (q?.outAmount) {
      // quote Jupiter = harga eksekusi paling jujur (harga DexScreener untuk token baru sering basi/palsu)
      gross = Number(q.outAmount) / LAMPORTS;
      route = "jupiter_quote";
      feeBps = q.feeBps ?? 0;
      impact = toNum(q.priceImpactPct) !== null ? Number(q.priceImpactPct) * 100 : null;
    } else {
      const m = this.market(mint);
      if (!m || !(m.priceSol > 0))
        return {
          ...base,
          ok: false,
          error: "no_price",
          route: "local_estimate",
          latencyMs: Math.round(performance.now() - t0),
        };
      const value = tokens * m.priceSol;
      impact = this.localImpactPct(value, m);
      const panicPenalty = opts.panic ? 2 : 0; // slippage tambahan saat panic
      gross = value * (1 - (impact + FALLBACK_POOL_FEE_PCT + FALLBACK_PLATFORM_FEE_PCT + panicPenalty) / 100);
      route = "local_estimate";
      feeBps = FALLBACK_PLATFORM_FEE_PCT * 100;
    }
    return {
      ok: true,
      route,
      tokens,
      sol: Math.max(0, gross - network + rent),
      execPrice: tokens > 0 ? gross / tokens : 0,
      networkFeeSol: network,
      platformFeeBps: feeBps,
      priceImpactPct: impact,
      rentDeltaSol: rent,
      quoteOut: q?.outAmount ?? null,
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  /**
   * Nilai jual EXECUTABLE sekarang: quote Jupiter token→SOL untuk jumlah persis, dikurangi biaya jaringan exit
   * (+ rent ATA kembali kalau menutup posisi). null kalau quote gagal / rate limit.
   */
  async quoteSellValue(
    mint: string,
    tokens: number,
    closesPosition = true,
  ): Promise<{ netSol: number; grossSol: number } | null> {
    const decimals = await this.tokenDecimals(mint);
    const raw = BigInt(Math.floor(tokens * 10 ** decimals));
    const q = await this.quote(mint, SOL_MINT, raw);
    if (!q?.outAmount) return null;
    const gross = Number(q.outAmount) / LAMPORTS;
    const rent = closesPosition && this.cfg().execution.close_ata_after_exit ? ATA_RENT_SOL : 0;
    return { grossSol: gross, netSol: gross - this.networkFeeSol("exit", false) + rent };
  }

  /** Estimasi biaya exit (%) untuk monitoring PnL tiap tick tanpa memanggil API. */
  estimateExitCostPct(mint: string, tokens: number): number {
    const m = this.market(mint);
    if (!m) return FALLBACK_POOL_FEE_PCT + FALLBACK_PLATFORM_FEE_PCT + 3;
    return this.localImpactPct(tokens * m.priceSol, m) + FALLBACK_POOL_FEE_PCT + FALLBACK_PLATFORM_FEE_PCT;
  }
}
