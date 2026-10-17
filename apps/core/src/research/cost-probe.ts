import { type Db, pgTextArray } from "@memebot/db";
import type { Logger, TradeConfig } from "@memebot/shared";
import type { PaperExecutor } from "../trading/paper-executor.ts";

/** Biaya round-trip (%) dari hasil probe. Murni → dites. */
export function roundTripCost(sizeSol: number, solBack: number, networkSol: number) {
  const quote = ((sizeSol - solBack) / sizeSol) * 100;
  const network = (networkSol / sizeSol) * 100;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { quoteCostPct: r(quote), networkCostPct: r(network), totalCostPct: r(quote + network) };
}

/**
 * Pengukur biaya eksekusi nyata: tiap `interval_sec`, ambil 1 token yang baru dievaluasi (sumber sesuai config,
 * punya data likuiditas, belum di-probe 60 menit terakhir) → quote beli → quote jual → simpan ke cost_probes.
 * Memakai anggaran quote Jupiter yang sama dengan paper executor (2 quote per probe).
 */
export class CostProbe {
  private timer: Timer;
  private busy = false;
  stats = { probes: 0, failed: 0 };

  constructor(
    private readonly cfg: () => TradeConfig,
    private readonly executor: PaperExecutor,
    private readonly db: Db,
    private readonly log: Logger,
  ) {
    this.timer = setInterval(
      () => void this.tick(),
      Math.max(10, cfg().execution.cost_probe.interval_sec) * 1000,
    );
  }

  private async pick(): Promise<{
    mint: string;
    source: string;
    liquidity: number | null;
    mcap: number | null;
  } | null> {
    const c = this.cfg().execution.cost_probe;
    const like = c.sources.map((s) => (s.endsWith(".") ? `${s}%` : s));
    const rows = (await this.db`
      SELECT DISTINCT ON (d.mint) d.mint, d.trigger_source AS source,
             (d.features->>'liquidity_usd')::numeric AS liquidity, (d.features->>'mcap_usd')::numeric AS mcap
      FROM decisions d
      WHERE d.stage = 'filter' AND d.ts > now() - interval '30 minutes'
        AND d.features->>'liquidity_usd' IS NOT NULL
        AND d.trigger_source LIKE ANY (${pgTextArray(like)}::text[])
        AND NOT EXISTS (SELECT 1 FROM cost_probes p WHERE p.mint = d.mint AND p.ts > now() - interval '60 minutes')
      ORDER BY d.mint, d.ts DESC
      LIMIT 50`) as { mint: string; source: string; liquidity: number | null; mcap: number | null }[];
    if (!rows.length) return null;
    // sebar ke berbagai likuiditas: pilih acak supaya tidak selalu token yang sama jenisnya
    return rows[Math.floor(Math.random() * rows.length)]!;
  }

  private async tick() {
    const c = this.cfg().execution.cost_probe;
    if (!c.enabled || this.busy) return;
    this.busy = true;
    try {
      const cand = await this.pick();
      if (!cand) return;
      const r = await this.executor.probeRoundTrip(cand.mint, c.size_sol);
      const base = {
        mint: cand.mint,
        source: cand.source,
        liquidity_usd: cand.liquidity,
        mcap_usd: cand.mcap,
        size_sol: c.size_sol,
      };
      if (!r.ok) {
        this.stats.failed++;
        await this.db`INSERT INTO cost_probes ${this.db({ ...base, error: r.error })}`;
        return;
      }
      const cost = roundTripCost(c.size_sol, r.solBack, r.networkSol);
      this.stats.probes++;
      await this.db`INSERT INTO cost_probes ${this.db({
        ...base,
        tokens_out: r.tokensOut,
        sol_back: r.solBack,
        buy_impact_pct: r.buyImpactPct,
        sell_impact_pct: r.sellImpactPct,
        platform_fee_bps: r.feeBps,
        router: r.router,
        quote_cost_pct: cost.quoteCostPct,
        network_cost_pct: cost.networkCostPct,
        total_cost_pct: cost.totalCostPct,
      })}`;
    } catch (err) {
      this.stats.failed++;
      this.log.warn({ err: String(err) }, "cost probe gagal");
    } finally {
      this.busy = false;
    }
  }

  stop() {
    clearInterval(this.timer);
  }
}
