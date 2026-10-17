import type { Db } from "@memebot/db";
import { pgTextArray } from "@memebot/db";
import { type EventBus, type Logger, type SourcesConfig, toNum } from "@memebot/shared";
import type { GmgnClient, GmgnFeedTrade } from "../enrich/gmgn.ts";
import { loadGoodWallets } from "./scoring.ts";

/**
 * Jendela konfluensi (murni): catat pembelian (mint, wallet, ts); kalau jumlah wallet bagus berbeda yang beli
 * mint yang sama dalam `windowMs` ≥ `minWallets`, kembalikan daftar wallet (sekali per mint per cooldown).
 */
export class ConfluenceWindow {
  private buys = new Map<string, Map<string, number>>();
  private firedAt = new Map<string, number>();

  constructor(
    private readonly minWallets: number,
    private readonly windowMs: number,
    private readonly cooldownMs = 60 * 60_000,
  ) {}

  add(mint: string, wallet: string, ts: number, now = Date.now()): string[] | null {
    if (now - ts > this.windowMs) return null; // pembelian lama tidak dihitung
    let m = this.buys.get(mint);
    if (!m) {
      m = new Map();
      this.buys.set(mint, m);
    }
    m.set(wallet, Math.max(m.get(wallet) ?? 0, ts));
    for (const [w, t] of m) if (now - t > this.windowMs) m.delete(w);
    if (m.size < this.minWallets) return null;
    const last = this.firedAt.get(mint);
    if (last !== undefined && now - last < this.cooldownMs) return null;
    this.firedAt.set(mint, now);
    return [...m.keys()];
  }

  count(mint: string, now = Date.now()): number {
    const m = this.buys.get(mint);
    if (!m) return 0;
    let n = 0;
    for (const t of m.values()) if (now - t <= this.windowMs) n++;
    return n;
  }

  prune(now = Date.now()) {
    for (const [mint, m] of this.buys) {
      for (const [w, t] of m) if (now - t > this.windowMs) m.delete(w);
      if (m.size === 0) this.buys.delete(mint);
    }
    for (const [mint, t] of this.firedAt) if (now - t > this.cooldownMs) this.firedAt.delete(mint);
  }
}

interface GmgnActivity {
  event_type?: string;
  type?: string;
  timestamp?: number;
  cost_usd?: number | string;
  token?: { address?: string; symbol?: string };
}

/** Detektor konfluensi: sumber = scan holder (WalletTracker) + polling aktivitas wallet watchlist. */
export class ConfluenceDetector {
  private window: ConfluenceWindow;
  private good = new Map<string, number | null>();
  /** wallet bertag GMGN (smart_degen / renowned / kol) yang terlihat di feed — dianggap tepercaya */
  private trusted = new Map<string, { tags: string[]; seenAt: number }>();
  private seenTx = new Set<string>();
  private feedBusy = false;
  private lastSeen = new Map<string, number>();
  private rr = 0;
  private timers: Timer[] = [];
  private polling = false;
  stats = {
    goodWallets: 0,
    trustedFeedWallets: 0,
    buysSeen: 0,
    signals: 0,
    polls: 0,
    pollFailed: 0,
    feedPolls: 0,
    feedBuys: 0,
  };

  constructor(
    private readonly cfg: () => SourcesConfig["wallet_tracker"],
    private readonly gmgn: GmgnClient,
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly log: Logger,
    private readonly symbolOf: (mint: string) => string | null,
  ) {
    const c = cfg().confluence;
    this.window = new ConfluenceWindow(c.min_wallets, c.window_min * 60_000);
    void this.refreshGood();
    this.timers.push(setInterval(() => void this.refreshGood(), 2 * 60_000));
    this.timers.push(setInterval(() => this.window.prune(), 60_000));
    const pollMs = Math.max(2000, 60_000 / c.activity_poll.polls_per_min);
    this.timers.push(setInterval(() => void this.pollNext(), pollMs));
    this.timers.push(setInterval(() => void this.pollFeeds(), c.gmgn_feeds.poll_sec * 1000));
  }

  async refreshGood() {
    try {
      this.good = await loadGoodWallets(this.db, this.cfg().scoring.min_score);
      this.stats.goodWallets = this.good.size;
    } catch (err) {
      this.log.warn({ err: String(err) }, "gagal memuat wallet bagus");
    }
  }

  isGood(wallet: string) {
    return this.good.has(wallet) || this.trusted.has(wallet);
  }

  /** Catat satu pembelian wallet. Kalau konfluensi tercapai → trigger + simpan sinyal. */
  async recordBuy(
    mint: string,
    wallet: string,
    ts: number,
    source: "holder_scan" | "wallet_activity" | "gmgn_feed",
  ) {
    const c = this.cfg().confluence;
    if (!c.enabled || !this.isGood(wallet)) return;
    this.stats.buysSeen++;
    const wallets = this.window.add(mint, wallet, ts);
    if (!wallets) return;
    const scores = wallets.map((w) => this.good.get(w)).filter((s): s is number => typeof s === "number");
    const avg = scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null;
    const symbol = this.symbolOf(mint);
    this.stats.signals++;
    this.log.info({ mint, symbol, wallets: wallets.length, avgScore: avg, source }, "KONFLUENSI smart money");
    await this.db`
      INSERT INTO smart_signals (mint, symbol, source, wallets, n_wallets, avg_score)
      VALUES (${mint}, ${symbol}, ${source}, ${pgTextArray(wallets)}, ${wallets.length}, ${avg})`;
    this.bus.emit({
      t: "TokenTriggered",
      mint,
      source: "wallet",
      kind: "smart_confluence",
      ts: Date.now(),
      payload: {
        backlog: false,
        wallets,
        source,
        features: { smart_confluence_count: wallets.length, smart_avg_score: avg },
      },
      meta: symbol ? { symbol } : undefined,
    });
  }

  /** Jumlah wallet bagus yang sedang tercatat membeli mint ini (untuk keputusan rescan). */
  goodCount(mint: string) {
    return this.window.count(mint);
  }

  /** Poll feed smart money / KOL GMGN → pembelian wallet bertag dianggap tepercaya. */
  private async pollFeeds() {
    const c = this.cfg().confluence;
    if (!c.enabled || !c.gmgn_feeds.enabled || this.feedBusy || this.gmgn.pausedForSec > 0) return;
    this.feedBusy = true;
    try {
      for (const feed of c.gmgn_feeds.feeds) {
        const list = await this.gmgn.trackFeed(feed, 50).catch(() => null);
        this.stats.feedPolls++;
        if (list) await this.ingestFeed(feed, list, c.gmgn_feeds.min_usd);
      }
      if (this.seenTx.size > 20_000) this.seenTx = new Set([...this.seenTx].slice(-5000));
      for (const [w, v] of this.trusted) if (Date.now() - v.seenAt > 24 * 3600_000) this.trusted.delete(w);
      this.stats.trustedFeedWallets = this.trusted.size;
    } finally {
      this.feedBusy = false;
    }
  }

  /** Proses satu halaman feed (dipisah supaya bisa dites). */
  async ingestFeed(feed: "smartmoney" | "kol", list: GmgnFeedTrade[], minUsd: number) {
    for (const t of list) {
      const tx = t.transaction_hash;
      const wallet = t.maker;
      const mint = t.base_address;
      if (!tx || !wallet || !mint || t.side !== "buy" || this.seenTx.has(tx)) continue;
      this.seenTx.add(tx);
      if ((toNum(t.amount_usd) ?? 0) < minUsd) continue;
      const tags = [...(t.maker_info?.tags ?? [])];
      if (feed === "kol" && !tags.includes("kol")) tags.push("kol");
      this.trusted.set(wallet, { tags, seenAt: Date.now() });
      this.stats.feedBuys++;
      await this.recordBuy(mint, wallet, (t.timestamp ?? 0) * 1000, "gmgn_feed");
    }
  }

  private async pollNext() {
    const c = this.cfg().confluence;
    if (!c.enabled || !c.activity_poll.enabled || this.polling || this.gmgn.pausedForSec > 0) return;
    const list = [...this.good.entries()]
      .sort((a, b) => (b[1] ?? 101) - (a[1] ?? 101)) // manual (null) dulu, lalu skor tertinggi
      .slice(0, c.activity_poll.max_wallets)
      .map(([w]) => w);
    if (list.length === 0) return;
    const wallet = list[this.rr++ % list.length]!;
    this.polling = true;
    try {
      const acts = (await this.gmgn.walletBuys(wallet, 20)) as GmgnActivity[] | null;
      this.stats.polls++;
      if (!acts) return;
      const now = Date.now();
      const since = this.lastSeen.get(wallet) ?? now - c.window_min * 60_000;
      let newest = since;
      for (const a of acts) {
        const type = a.event_type ?? a.type;
        const ts = (a.timestamp ?? 0) * 1000;
        const mint = a.token?.address;
        if (type !== "buy" || !mint || ts <= since) continue;
        newest = Math.max(newest, ts);
        await this.recordBuy(mint, wallet, ts, "wallet_activity");
      }
      this.lastSeen.set(wallet, newest);
    } catch (err) {
      this.stats.pollFailed++;
      this.log.debug({ wallet, err: String(err) }, "poll aktivitas wallet gagal");
    } finally {
      this.polling = false;
    }
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }
}
