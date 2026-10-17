import { type Db, pgTextArray } from "@memebot/db";
import { type EventBus, type Logger, type SourcesConfig, TtlSet, toNum } from "@memebot/shared";
import type { GmgnClient, GmgnHolder } from "../enrich/gmgn.ts";

/**
 * Wallet tracker: untuk token yang dievaluasi pipeline, ambil top holder dari GMGN lalu catat
 *  - `top_holder`: N holder terbesar (% supply), tanpa akun pool/bonding curve/exchange
 *  - `big_buyer` : wallet dengan total beli (USD) ≥ ambang (tier tertinggi yang terlewati, mis. 500 / 1000)
 * Hasil masuk `wallet_observations` → bahan profile smart_money & watchlist (Fase 6).
 */

export interface WalletObservation {
  wallet: string;
  mint: string;
  kind: "top_holder" | "big_buyer";
  rank: number | null;
  buy_tier_usd: number | null;
  usd_value: number | null;
  amount_pct: number | null;
  buy_volume_usd: number | null;
  sell_volume_usd: number | null;
  profit_usd: number | null;
  tags: string[];
  maker_tags: string[];
}

/** Akun yang bukan wallet trader (pool, bonding curve, exchange/CEX, program). */
export function isNonTraderAccount(h: GmgnHolder): boolean {
  if (h.exchange && h.exchange.length > 0) return true;
  if (h.addr_type !== undefined && h.addr_type !== 0) return true;
  const tags = [...(h.tags ?? []), ...(h.maker_token_tags ?? [])];
  return tags.some((t) => ["pool", "liquidity_pool", "exchange", "cex", "burn"].includes(t));
}

/** Klasifikasi murni → daftar observasi (satu wallet bisa top_holder DAN big_buyer). */
export function classifyHolders(
  mint: string,
  holders: GmgnHolder[],
  cfg: { top_n: number; big_buyer_usd: number[] },
): WalletObservation[] {
  const tiers = [...cfg.big_buyer_usd].sort((a, b) => a - b);
  const traders = holders
    .filter((h) => h.address && !isNonTraderAccount(h))
    .sort((a, b) => (toNum(b.amount_percentage) ?? 0) - (toNum(a.amount_percentage) ?? 0));
  const out: WalletObservation[] = [];
  traders.forEach((h, i) => {
    const base = {
      wallet: h.address,
      mint,
      usd_value: toNum(h.usd_value),
      amount_pct:
        toNum(h.amount_percentage) !== null ? Math.round(Number(h.amount_percentage) * 1e6) / 1e4 : null,
      buy_volume_usd: toNum(h.buy_volume_cur),
      sell_volume_usd: toNum(h.sell_volume_cur),
      profit_usd: toNum(h.profit),
      tags: h.tags ?? [],
      maker_tags: h.maker_token_tags ?? [],
    };
    if (i < cfg.top_n) out.push({ ...base, kind: "top_holder", rank: i + 1, buy_tier_usd: null });
    const buy = toNum(h.buy_volume_cur) ?? 0;
    const tier = tiers.filter((t) => buy >= t).pop();
    if (tier !== undefined) out.push({ ...base, kind: "big_buyer", rank: null, buy_tier_usd: tier });
  });
  return out;
}

export class WalletTracker {
  private queue: { mint: string; dueAt: number }[] = [];
  private queued = new Set<string>();
  private seen: TtlSet;
  private timer: Timer;
  private busy = false;
  private lastScanAt = 0;
  stats = { scanned: 0, observations: 0, failed: 0, queue: 0 };

  constructor(
    private readonly cfg: () => SourcesConfig["wallet_tracker"],
    private readonly gmgn: GmgnClient,
    private readonly db: Db,
    private readonly log: Logger,
    bus: EventBus,
    private readonly symbolOf: (mint: string) => string | null,
  ) {
    this.seen = new TtlSet(cfg().rescan_after_min * 60_000);
    // token yang selesai dievaluasi filter (profile mana pun) → jadwalkan scan holder
    bus.on("Decision", (e) => {
      if (e.stage === "filter") this.enqueue(e.mint);
    });
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  enqueue(mint: string, delaySec = this.cfg().delay_sec) {
    if (!this.cfg().enabled || this.queued.has(mint) || !this.seen.add(mint)) return;
    this.queued.add(mint);
    this.queue.push({ mint, dueAt: Date.now() + delaySec * 1000 });
    this.stats.queue = this.queue.length;
  }

  private async tick() {
    const cfg = this.cfg();
    if (!cfg.enabled || this.busy || Date.now() - this.lastScanAt < cfg.min_interval_sec * 1000) return;
    if (this.gmgn.pausedForSec > 0) return; // GMGN sedang kena rate limit → tunggu
    const idx = this.queue.findIndex((q) => q.dueAt <= Date.now());
    if (idx < 0) return;
    const [job] = this.queue.splice(idx, 1);
    if (!job) return;
    this.queued.delete(job.mint);
    this.stats.queue = this.queue.length;
    this.busy = true;
    this.lastScanAt = Date.now();
    try {
      const holders = await this.gmgn.topHolders(job.mint, cfg.fetch_limit);
      if (!holders) throw new Error("tidak ada data holder");
      const obs = classifyHolders(job.mint, holders, cfg);
      await this.save(job.mint, obs);
      this.stats.scanned++;
      this.stats.observations += obs.length;
    } catch (err) {
      this.stats.failed++;
      this.log.debug({ mint: job.mint, err: String(err) }, "scan holder gagal");
    } finally {
      this.busy = false;
    }
  }

  private async save(mint: string, obs: WalletObservation[]) {
    if (obs.length === 0) return;
    const symbol = this.symbolOf(mint);
    const rows = obs.map((o) => ({
      ...o,
      symbol,
      ts: new Date(),
      tags: pgTextArray(o.tags),
      maker_tags: pgTextArray(o.maker_tags),
    }));
    await this.db`
      INSERT INTO wallet_observations ${this.db(rows)}
      ON CONFLICT (wallet, mint, kind) DO UPDATE SET
        ts = EXCLUDED.ts, symbol = COALESCE(EXCLUDED.symbol, wallet_observations.symbol), rank = EXCLUDED.rank,
        buy_tier_usd = EXCLUDED.buy_tier_usd, usd_value = EXCLUDED.usd_value, amount_pct = EXCLUDED.amount_pct,
        buy_volume_usd = EXCLUDED.buy_volume_usd, sell_volume_usd = EXCLUDED.sell_volume_usd,
        profit_usd = EXCLUDED.profit_usd, tags = EXCLUDED.tags, maker_tags = EXCLUDED.maker_tags`;
  }

  /** Tandai wallet untuk dipantau (watchlist) / lepas. */
  async setWatch(address: string, active: boolean, label?: string) {
    await this.db`
      INSERT INTO watch_wallets (address, label, source, active)
      VALUES (${address}, ${label ?? null}, 'dashboard', ${active})
      ON CONFLICT (address) DO UPDATE SET active = EXCLUDED.active, label = COALESCE(EXCLUDED.label, watch_wallets.label)`;
  }

  stop() {
    clearInterval(this.timer);
  }
}
