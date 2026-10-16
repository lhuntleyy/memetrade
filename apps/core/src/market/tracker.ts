import type { Db } from "@memebot/db";
import type { EventBus, EventOf, Logger, SourcesConfig } from "@memebot/shared";
import { toNum } from "@memebot/shared";
import { type DexPair, type DexScreenerClient, pickMainPair } from "../collectors/dexscreener.ts";
import { BatchWriter } from "../journal/batch.ts";
import { type PathRow, PathStats } from "./path-stats.ts";

interface TickRow {
  ts: Date;
  mint: string;
  price_sol: number;
  price_usd: number | null;
  mcap_usd: number | null;
  liquidity_sol: number | null;
  source: string;
}

/**
 * Market tracker Fase 1: setiap token yang ter-trigger dipantau `track_minutes` menit.
 * Sumber harga: polling DexScreener `/tokens/v1` (≤30 mint/req, gratis). Nanti ditambah
 * sumber real-time (accountSubscribe pool / trade stream) lewat event PriceTick yang sama.
 */
export class MarketTracker {
  /** key `${mint}|${sourceKey}` → path aktif */
  private paths = new Map<string, PathStats>();
  /** pair DexScreener terbaru per mint (dipakai enrichment, tanpa request tambahan) */
  private latest = new Map<string, { pair: DexPair; at: number }>();
  private byMint = new Map<string, Set<string>>();
  private ticks: BatchWriter<TickRow>;
  private pathUpserts: BatchWriter<PathRow>;
  private loopTimer: Timer | undefined;
  private sweepTimer: Timer;
  private running = true;
  stats = { started: 0, completed: 0, rejectedFull: 0, pollCycles: 0, lastCycleMs: 0 };

  constructor(
    private readonly cfg: SourcesConfig["tracker"],
    private readonly dex: DexScreenerClient,
    private readonly bus: EventBus,
    db: Db,
    private readonly log: Logger,
  ) {
    this.ticks = new BatchWriter<TickRow>(
      "ticks",
      async (rows) => {
        await db`INSERT INTO ticks ${db(rows)}`;
      },
      log,
      cfg.tick_flush_ms,
    );
    this.pathUpserts = new BatchWriter<PathRow>(
      "tracked_paths",
      async (rows) => {
        // satu path bisa muncul >1x dalam batch → ambil versi terakhir
        const last = new Map(rows.map((r) => [`${r.mint}|${r.source}|${r.t0.getTime()}`, r]));
        await db`
          INSERT INTO tracked_paths ${db([...last.values()])}
          ON CONFLICT (mint, source, t0) DO UPDATE SET
            entry_price_ref = EXCLUDED.entry_price_ref, ref_delay_sec = EXCLUDED.ref_delay_sec,
            n_ticks = EXCLUDED.n_ticks, ret_1m = EXCLUDED.ret_1m, ret_5m = EXCLUDED.ret_5m,
            ret_15m = EXCLUDED.ret_15m, ret_60m = EXCLUDED.ret_60m, max_ret = EXCLUDED.max_ret,
            t_max_sec = EXCLUDED.t_max_sec, min_ret = EXCLUDED.min_ret, t_min_sec = EXCLUDED.t_min_sec,
            rugged = EXCLUDED.rugged, completed_at = EXCLUDED.completed_at`;
      },
      log,
      5000,
    );

    bus.on("TokenTriggered", (e) => this.onTrigger(e));
    bus.on("PriceTick", (e) => this.onTick(e));
    // simpan progres tiap 30 dtk & tutup path yang sudah selesai
    this.sweepTimer = setInterval(() => this.sweep(), 30_000);
    void this.pollLoop();
  }

  /** mint yang dipantau tanpa batas waktu (posisi terbuka) */
  private pinned = new Set<string>();

  /** Pantau harga mint terus-menerus (dipakai position manager selama posisi terbuka). */
  pin(mint: string) {
    this.pinned.add(mint);
    if (!this.byMint.has(mint)) this.byMint.set(mint, new Set());
  }

  unpin(mint: string) {
    this.pinned.delete(mint);
    const set = this.byMint.get(mint);
    if (set && set.size === 0) {
      this.byMint.delete(mint);
      this.latest.delete(mint);
    }
  }

  /** Pair terbaru untuk mint yang sedang di-track (null kalau belum ter-index / umur > maxAgeMs). */
  latestPair(mint: string, maxAgeMs = 30_000): DexPair | null {
    const l = this.latest.get(mint);
    return l && Date.now() - l.at <= maxAgeMs ? l.pair : null;
  }

  get activeTokens() {
    return this.byMint.size;
  }
  get activePaths() {
    return this.paths.size;
  }

  private onTrigger(e: EventOf<"TokenTriggered">) {
    if ((e.payload as { backlog?: boolean } | null)?.backlog) return; // backlog saat start: bukan "first seen"
    const sourceKey = `${e.source}.${e.kind}`;
    const key = `${e.mint}|${sourceKey}`;
    if (this.paths.has(key)) return;
    if (!this.byMint.has(e.mint) && this.byMint.size >= this.cfg.max_concurrent_tokens) {
      this.stats.rejectedFull++;
      return;
    }
    const p = new PathStats(e.mint, sourceKey, e.ts, e.meta?.priceSol ?? null);
    this.paths.set(key, p);
    let set = this.byMint.get(e.mint);
    if (!set) {
      set = new Set();
      this.byMint.set(e.mint, set);
    }
    set.add(key);
    this.stats.started++;
    this.pathUpserts.push(p.toRow());
  }

  private onTick(e: EventOf<"PriceTick">) {
    const keys = this.byMint.get(e.mint);
    if (!keys) return;
    for (const k of keys) this.paths.get(k)?.update(e.ts, e.priceSol);
  }

  private sweep(now = Date.now()) {
    for (const [key, p] of this.paths) {
      if (p.isDue(now, this.cfg.track_minutes)) {
        p.complete(now);
        this.pathUpserts.push(p.toRow());
        this.paths.delete(key);
        const set = this.byMint.get(p.mint);
        set?.delete(key);
        if (set && set.size === 0 && !this.pinned.has(p.mint)) {
          this.byMint.delete(p.mint);
          this.latest.delete(p.mint);
        }
        this.stats.completed++;
      } else if (p.ticks > 0) {
        this.pathUpserts.push(p.toRow());
      }
    }
  }

  /** Loop polling: semua mint aktif dibagi per 30, laju dibatasi rate limiter client (± 270 req/menit). */
  private async pollLoop() {
    while (this.running) {
      const t0 = performance.now();
      const mints = [...this.byMint.keys()];
      for (let i = 0; i < mints.length && this.running; i += 30) {
        const chunk = mints.slice(i, i + 30);
        try {
          const pairs = await this.dex.pairs(chunk);
          const now = Date.now();
          for (const mint of chunk) {
            const pair = pickMainPair(pairs, mint);
            const priceSol = toNum(pair?.priceNative);
            if (!pair || priceSol === null) continue;
            this.latest.set(mint, { pair, at: now });
            const tick = {
              t: "PriceTick" as const,
              mint,
              ts: now,
              priceSol,
              priceUsd: toNum(pair.priceUsd) ?? undefined,
              mcapUsd: toNum(pair.marketCap ?? pair.fdv) ?? undefined,
              liquidityUsd: toNum(pair.liquidity?.usd) ?? undefined,
              source: `dexscreener:${pair.dexId}`,
            };
            this.bus.emit(tick);
            const priceUsd = tick.priceUsd ?? null;
            this.ticks.push({
              ts: new Date(now),
              mint,
              price_sol: priceSol,
              price_usd: priceUsd,
              mcap_usd: tick.mcapUsd ?? null,
              // likuiditas DexScreener dalam USD → konversi ke SOL via rasio harga
              liquidity_sol: tick.liquidityUsd && priceUsd ? (tick.liquidityUsd * priceSol) / priceUsd : null,
              source: tick.source,
            });
          }
        } catch (err) {
          const msg = String(err);
          this.log.warn({ err: msg, n: chunk.length }, "poll harga gagal");
          // rate limit / jeda global → hentikan putaran ini (client yang mengatur lama jeda)
          if (msg.includes("429") || msg.includes("dijeda")) break;
        }
      }
      this.stats.pollCycles++;
      this.stats.lastCycleMs = Math.round(performance.now() - t0);
      // minimal 4 dtk per putaran; kalau DexScreener sedang dijeda, tunggu sampai jeda selesai
      const wait = Math.max(4000 - this.stats.lastCycleMs, this.dex.pausedForSec * 1000);
      await new Promise((r) => {
        this.loopTimer = setTimeout(r, wait);
      });
    }
  }

  async stop() {
    this.running = false;
    clearTimeout(this.loopTimer);
    clearInterval(this.sweepTimer);
    // simpan progres terakhir (belum selesai → completed_at null, dilanjut/diabaikan setelah restart)
    for (const p of this.paths.values()) if (p.ticks > 0) this.pathUpserts.push(p.toRow());
    await this.ticks.stop();
    await this.pathUpserts.stop();
  }
}
