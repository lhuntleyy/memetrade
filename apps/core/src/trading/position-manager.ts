import { type Db, pgTextArray } from "@memebot/db";
import {
  type EventBus,
  type EventOf,
  effectiveMode,
  type Logger,
  type StrategyConfig,
  type TradeConfig,
  toNum,
} from "@memebot/shared";
import type { MarketTracker } from "../market/tracker.ts";
import {
  applySell,
  type ExitAction,
  type ExitReason,
  type ExitState,
  evaluateExit,
  newExitState,
} from "./exit-engine.ts";
import type { FillResult, PaperExecutor } from "./paper-executor.ts";
import { checkRisk } from "./risk.ts";

interface OpenPosition {
  id: number;
  mint: string;
  symbol: string | null;
  profile: string;
  mode: "paper" | "live";
  exitRef: string;
  sizeSol: number;
  costSol: number;
  tokensInitial: number;
  tokensHeld: number;
  proceedsSol: number;
  feesSol: number;
  openedAt: number;
  state: ExitState;
  lastPrice: number | null;
  lastMarkAt: number;
  busy: boolean;
  /** jumlah percobaan jual gagal beruntun (untuk alert & panic) */
  sellFails: number;
}

export interface PositionManagerDeps {
  bus: EventBus;
  db: Db;
  log: Logger;
  tracker: MarketTracker;
  executor: PaperExecutor;
  trade: () => TradeConfig;
  strategy: () => StrategyConfig;
  strategyVersion: () => number;
  killed: () => boolean;
  symbolOf: (mint: string) => string | null;
}

const MARK_EVERY_MS = 15_000;

/**
 * Position manager Fase 3 (PAPER): Signal → risk → entry (paper executor) → pantau tiap tick → exit engine.
 * Mode live sengaja belum diimplementasi: kalau mode efektif = live, entry ditolak.
 */
export class PositionManager {
  private open = new Map<number, OpenPosition>();
  private lastEntryAt = new Map<string, number>();
  private pendingMints = new Set<string>();
  private dailyPnlSol = 0;
  private dailyKey = "";
  private tradesToday = 0;
  private recentWins: boolean[] = [];
  private lastCloseAt: number | null = null;
  private realizedTotalSol = 0;
  private timer: Timer;
  stats = { signals: 0, riskRejected: 0, entries: 0, entryFailed: 0, exits: 0, sellFailed: 0 };

  constructor(private readonly d: PositionManagerDeps) {
    d.bus.on("Signal", (e) => void this.onSignal(e));
    d.bus.on("PriceTick", (e) => void this.onTick(e.mint, e.ts, e.priceSol));
    // cek berkala (max hold / stale tetap jalan walau tick berhenti)
    this.timer = setInterval(() => {
      for (const p of this.open.values())
        if (p.lastPrice) void this.onTick(p.mint, Date.now(), p.lastPrice, true);
    }, 5000);
  }

  /** Muat posisi terbuka & statistik hari ini dari DB (setelah restart). */
  async restore() {
    const rows = await this.d.db`
      SELECT id, mint, symbol, profile, mode, size_sol, cost_sol, tokens_initial, tokens_held, proceeds_sol, fees_sol,
             opened_at, exit_state, last_price, exit_reason
      FROM positions WHERE status IN ('OPEN', 'PARTIAL_EXIT', 'EXITING')`;
    for (const r of rows) {
      const profile = this.d.strategy().profiles[r.profile];
      const state =
        (r.exit_state as ExitState | null) ??
        newExitState(Number(r.cost_sol) / Number(r.tokens_initial), new Date(r.opened_at).getTime());
      const p: OpenPosition = {
        id: Number(r.id),
        mint: r.mint,
        symbol: r.symbol,
        profile: r.profile,
        mode: r.mode,
        exitRef: (profile?.exits.ref ?? "").replace(/^exits\./, ""),
        sizeSol: Number(r.size_sol),
        costSol: Number(r.cost_sol),
        tokensInitial: Number(r.tokens_initial),
        tokensHeld: Number(r.tokens_held),
        proceedsSol: Number(r.proceeds_sol),
        feesSol: Number(r.fees_sol),
        openedAt: new Date(r.opened_at).getTime(),
        state,
        lastPrice: toNum(r.last_price),
        lastMarkAt: 0,
        busy: false,
        sellFails: 0,
      };
      this.open.set(p.id, p);
      this.d.tracker.pin(p.mint);
      this.lastEntryAt.set(p.mint, p.openedAt);
    }
    const [today] = await this.d.db`
      SELECT COALESCE(sum(realized_pnl_sol), 0)::float AS pnl, count(*)::int AS n
      FROM positions WHERE closed_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND status = 'CLOSED'`;
    const [opened] = await this.d.db`
      SELECT count(*)::int AS n FROM positions WHERE opened_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
    const recent = await this.d
      .db`SELECT realized_pnl_sol > 0 AS win, closed_at FROM positions WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT 20`;
    const [total] = await this.d
      .db`SELECT COALESCE(sum(realized_pnl_sol), 0)::float AS pnl FROM positions WHERE status = 'CLOSED' AND mode = 'paper'`;
    this.dailyKey = new Date().toISOString().slice(0, 10);
    this.dailyPnlSol = Number(today?.pnl ?? 0);
    this.tradesToday = Number(opened?.n ?? 0);
    this.recentWins = recent.map((r: { win: boolean }) => r.win);
    this.lastCloseAt = recent[0] ? new Date(recent[0].closed_at).getTime() : null;
    this.realizedTotalSol = Number(total?.pnl ?? 0);
    this.d.log.info({ open: this.open.size, dailyPnlSol: this.dailyPnlSol }, "posisi dipulihkan dari DB");
  }

  private rollDay(now: number) {
    const key = new Date(now).toISOString().slice(0, 10);
    if (key !== this.dailyKey) {
      this.dailyKey = key;
      this.dailyPnlSol = 0;
      this.tradesToday = 0;
    }
  }

  get openPositions() {
    return [...this.open.values()];
  }

  summary() {
    return {
      open: this.open.size,
      exposureSol: round(this.openPositions.reduce((a, p) => a + p.sizeSol, 0)),
      dailyPnlSol: round(this.dailyPnlSol),
      tradesToday: this.tradesToday,
      realizedTotalSol: round(this.realizedTotalSol),
      ...this.stats,
    };
  }

  private async onSignal(e: EventOf<"Signal">) {
    this.stats.signals++;
    const trade = this.d.trade();
    const profile = this.d.strategy().profiles[e.profile];
    if (!profile) return;
    const mode = effectiveMode(trade.mode, profile.mode);
    if (mode === "off") return;
    if (mode === "live") {
      this.d.log.error(
        { mint: e.mint, profile: e.profile },
        "mode LIVE belum diimplementasi (Fase 5) — entry dilewati",
      );
      return;
    }
    if (this.pendingMints.has(e.mint)) return;
    const now = Date.now();
    this.rollDay(now);

    const openList = this.openPositions.map((p) => ({
      profile: p.profile,
      mint: p.mint,
      sizeSol: p.sizeSol,
    }));
    const exposure = openList.reduce((a, p) => a + p.sizeSol, 0);
    const verdict = checkRisk(
      trade,
      {
        now,
        killed: this.d.killed(),
        open: openList,
        dailyPnlSol: this.dailyPnlSol,
        tradesToday: this.tradesToday,
        recentWins: this.recentWins,
        lastEntryAt: this.lastEntryAt,
        lastCloseAt: this.lastCloseAt,
        freeSol: trade.bankroll.reference_sol + this.realizedTotalSol - exposure,
      },
      { profile: e.profile, mint: e.mint, sizeSol: profile.entry.size_sol },
    );
    await this.d.db`
      INSERT INTO decisions (ts, mint, profile, stage, passed, failed_rules, features, config_version)
      VALUES (${new Date(now)}, ${e.mint}, ${e.profile}, 'risk', ${verdict.ok}, ${pgTextArray(verdict.reasons)},
              ${{ size_sol: verdict.sizeSol, open: openList.length, daily_pnl_sol: this.dailyPnlSol }}, ${this.d.strategyVersion()})`;
    if (!verdict.ok) {
      this.stats.riskRejected++;
      this.d.bus.emit({
        t: "Position",
        action: "risk_rejected",
        id: null,
        mint: e.mint,
        profile: e.profile,
        mode,
        reason: verdict.reasons.join(","),
      });
      return;
    }

    this.pendingMints.add(e.mint);
    this.lastEntryAt.set(e.mint, now);
    this.tradesToday++;
    const symbol = this.d.symbolOf(e.mint);
    try {
      const [row] = await this.d.db`
        INSERT INTO positions (mint, symbol, profile, mode, status, size_sol, config_version, trigger_source)
        VALUES (${e.mint}, ${symbol}, ${e.profile}, ${mode}, 'PENDING_ENTRY', ${verdict.sizeSol}, ${this.d.strategyVersion()}, ${null})
        RETURNING id`;
      const id = Number(row.id);
      this.d.tracker.pin(e.mint);
      const fill = await this.d.executor.buy(e.mint, verdict.sizeSol, profile.entry.max_price_impact_pct);
      const orderId = await this.recordOrder(id, mode, "buy", "entry", verdict.sizeSol, fill);
      if (!fill.ok) {
        this.stats.entryFailed++;
        await this.d
          .db`UPDATE positions SET status = 'ENTRY_FAILED', closed_at = now(), exit_reason = ${fill.error ?? "fail"} WHERE id = ${id}`;
        this.d.tracker.unpin(e.mint);
        this.d.bus.emit({
          t: "Position",
          action: "entry_failed",
          id,
          mint: e.mint,
          profile: e.profile,
          mode,
          symbol,
          reason: fill.error,
        });
        return;
      }
      await this.recordFill(orderId, "buy", fill);
      const openedAt = Date.now();
      const entryPrice = fill.sol / fill.tokens; // termasuk fee & rent → break-even realistis
      const state = newExitState(entryPrice, openedAt);
      const exitRef = profile.exits.ref.replace(/^exits\./, "");
      await this.d.db`
        UPDATE positions SET status = 'OPEN', opened_at = ${new Date(openedAt)}, entry_price = ${fill.execPrice},
          tokens_initial = ${fill.tokens}, tokens_held = ${fill.tokens}, cost_sol = ${fill.sol},
          fees_sol = ${fill.networkFeeSol}, exit_state = ${state}, last_price = ${fill.execPrice}
        WHERE id = ${id}`;
      this.open.set(id, {
        id,
        mint: e.mint,
        symbol,
        profile: e.profile,
        mode,
        exitRef,
        sizeSol: verdict.sizeSol,
        costSol: fill.sol,
        tokensInitial: fill.tokens,
        tokensHeld: fill.tokens,
        proceedsSol: 0,
        feesSol: fill.networkFeeSol,
        openedAt,
        state,
        lastPrice: null,
        lastMarkAt: 0,
        busy: false,
        sellFails: 0,
      });
      this.stats.entries++;
      this.d.log.info(
        { id, mint: e.mint, profile: e.profile, sol: round(fill.sol), route: fill.route },
        "PAPER ENTRY",
      );
      this.d.bus.emit({
        t: "Position",
        action: "opened",
        id,
        mint: e.mint,
        profile: e.profile,
        mode,
        symbol,
      });
    } finally {
      this.pendingMints.delete(e.mint);
    }
  }

  private async onTick(mint: string, ts: number, price: number, periodic = false) {
    for (const p of this.open.values()) {
      if (p.mint !== mint || p.busy) continue;
      if (!periodic) p.lastPrice = price;
      const cfg = this.d.strategy().exits[p.exitRef];
      if (!cfg) continue;
      const exitCostPct = this.d.executor.estimateExitCostPct(p.mint, p.tokensHeld);
      const action = evaluateExit(cfg, p.state, { ts, price, exitCostPct });
      if (ts - p.lastMarkAt >= MARK_EVERY_MS) {
        p.lastMarkAt = ts;
        void this.mark(p, ts, price, action.pnlPct);
      }
      if (action.type === "sell") await this.sell(p, action);
    }
  }

  private async mark(p: OpenPosition, ts: number, price: number, pnlPct: number) {
    try {
      await this.d.db`INSERT INTO position_marks (ts, position_id, price, pnl_pct, exec_value_sol)
                      VALUES (${new Date(ts)}, ${p.id}, ${price}, ${pnlPct}, ${p.tokensHeld * price})`;
      await this.d.db`UPDATE positions SET last_price = ${price}, exit_state = ${p.state},
                        mfe_pct = ${p.state.peakPnlPct}, mae_pct = LEAST(COALESCE(mae_pct, ${pnlPct}), ${pnlPct})
                      WHERE id = ${p.id}`;
    } catch (err) {
      this.d.log.warn({ id: p.id, err: String(err) }, "gagal simpan mark");
    }
  }

  /** Jual manual / panic dari control API. */
  async closeManual(id: number, reason: "manual" | "panic"): Promise<boolean> {
    const p = this.open.get(id);
    if (!p) return false;
    await this.sell(p, { type: "sell", reason, fracOfRemaining: 1, pnlPct: 0 });
    return true;
  }

  async panicAll() {
    await Promise.all(this.openPositions.map((p) => this.closeManual(p.id, "panic")));
  }

  private async sell(p: OpenPosition, action: Extract<ExitAction, { type: "sell" }>) {
    if (p.busy) return;
    p.busy = true;
    try {
      const closes = action.fracOfRemaining >= 0.999;
      const tokens = closes ? p.tokensHeld : p.tokensHeld * action.fracOfRemaining;
      const panic = ["hard_sl", "panic", "break_even", "trailing"].includes(action.reason);
      const fill = await this.d.executor.sell(p.mint, tokens, { panic, closesPosition: closes });
      const orderId = await this.recordOrder(p.id, p.mode, "sell", action.reason, tokens, fill);
      if (!fill.ok) {
        p.sellFails++;
        this.stats.sellFailed++;
        if (p.sellFails === 3)
          this.d.log.error({ id: p.id, mint: p.mint, reason: action.reason }, "jual gagal 3x beruntun");
        return; // dicoba lagi di tick berikutnya
      }
      p.sellFails = 0;
      await this.recordFill(orderId, "sell", fill);
      applySell(p.state, action);
      p.tokensHeld = closes ? 0 : p.tokensHeld - tokens;
      p.proceedsSol += fill.sol;
      p.feesSol += fill.networkFeeSol;
      this.stats.exits++;

      if (closes || p.tokensHeld <= p.tokensInitial * 1e-6) {
        const pnlSol = p.proceedsSol - p.costSol;
        const pnlPct = (pnlSol / p.costSol) * 100;
        await this.d.db`
          UPDATE positions SET status = 'CLOSED', closed_at = now(), tokens_held = 0, proceeds_sol = ${p.proceedsSol},
            fees_sol = ${p.feesSol}, realized_pnl_sol = ${pnlSol}, pnl_pct = ${pnlPct}, exit_reason = ${action.reason},
            exit_state = ${p.state}, mfe_pct = ${p.state.peakPnlPct}
          WHERE id = ${p.id}`;
        this.open.delete(p.id);
        this.d.tracker.unpin(p.mint);
        this.rollDay(Date.now());
        this.dailyPnlSol += pnlSol;
        this.realizedTotalSol += pnlSol;
        this.recentWins.unshift(pnlSol > 0);
        this.recentWins.length = Math.min(this.recentWins.length, 20);
        this.lastCloseAt = Date.now();
        this.d.log.info(
          { id: p.id, mint: p.mint, reason: action.reason, pnlPct: round(pnlPct), pnlSol: round(pnlSol) },
          "PAPER EXIT",
        );
        this.d.bus.emit({
          t: "Position",
          action: "closed",
          id: p.id,
          mint: p.mint,
          profile: p.profile,
          mode: p.mode,
          symbol: p.symbol,
          pnlPct,
          pnlSol,
          reason: action.reason,
        });
      } else {
        await this.d.db`
          UPDATE positions SET status = 'PARTIAL_EXIT', tokens_held = ${p.tokensHeld}, proceeds_sol = ${p.proceedsSol},
            fees_sol = ${p.feesSol}, exit_state = ${p.state}
          WHERE id = ${p.id}`;
        this.d.bus.emit({
          t: "Position",
          action: "partial",
          id: p.id,
          mint: p.mint,
          profile: p.profile,
          mode: p.mode,
          symbol: p.symbol,
          reason: action.reason,
        });
      }
    } catch (err) {
      this.d.log.error({ id: p.id, err: String(err) }, "error saat jual");
    } finally {
      p.busy = false;
    }
  }

  private async recordOrder(
    positionId: number,
    mode: string,
    side: "buy" | "sell",
    reason: ExitReason | "entry",
    amount: number,
    f: FillResult,
  ) {
    const [o] = await this.d.db`
      INSERT INTO orders (client_id, position_id, mode, side, reason, amount_in, quoted_out, route, status, error, latency_ms)
      VALUES (${crypto.randomUUID()}, ${positionId}, ${mode}, ${side}, ${reason}, ${amount}, ${f.quoteOut},
              ${f.route}, ${f.ok ? "CONFIRMED" : "FAILED"}, ${f.error ?? null}, ${f.latencyMs})
      RETURNING id`;
    return Number(o.id);
  }

  /** buy: amount_in = SOL keluar, amount_out = token; sell: amount_in = token, amount_out = SOL masuk bersih */
  private async recordFill(orderId: number, side: "buy" | "sell", f: FillResult) {
    const [amountIn, amountOut] = side === "buy" ? [f.sol, f.tokens] : [f.tokens, f.sol];
    await this.d.db`
      INSERT INTO fills (order_id, ts, amount_in, amount_out, exec_price, network_fee_sol, platform_fee, rent_delta_sol)
      VALUES (${orderId}, now(), ${amountIn}, ${amountOut}, ${f.execPrice}, ${f.networkFeeSol}, ${f.platformFeeBps}, ${f.rentDeltaSol})`;
  }

  stop() {
    clearInterval(this.timer);
  }
}

function round(v: number) {
  return Math.round(v * 10_000) / 10_000;
}
