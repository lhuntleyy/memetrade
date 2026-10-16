import { describe, expect, test } from "bun:test";
import { ExitConfig, loadConfig, TradeConfig } from "@memebot/shared";
import { applySell, evaluateExit, newExitState } from "../src/trading/exit-engine.ts";
import { checkRisk, type RiskState } from "../src/trading/risk.ts";

const S = 1000;
// config exit mirip momentum_fast tapi tanpa momentum_fail/stale supaya tiap rule bisa dites terpisah
const cfg = ExitConfig.parse({
  hard_sl_pct: -15,
  break_even: { activate_at_pct: 20, lock_pct: 2 },
  take_profit_ladder: [
    { at_pct: 25, sell_pct: 40 },
    { at_pct: 60, sell_pct: 30 },
    { at_pct: 1000, sell_pct: 100 },
  ],
  trailing: {
    tiers: [
      { activate_at_pct: 10, distance_pct: 6 },
      { activate_at_pct: 40, distance_pct: 12 },
    ],
  },
  max_hold_sec: 1800,
});
const tick = (ts: number, price: number, exitCostPct = 0) => ({ ts, price, exitCostPct });

describe("exit engine", () => {
  test("hard SL", () => {
    const s = newExitState(1, 0);
    expect(evaluateExit(cfg, s, tick(S, 0.84))).toMatchObject({ type: "sell", reason: "hard_sl" });
  });

  test("biaya exit ikut dihitung (harga +0% tapi biaya 16% → kena SL)", () => {
    const s = newExitState(1, 0);
    expect(evaluateExit(cfg, s, tick(S, 1, 16))).toMatchObject({ type: "sell", reason: "hard_sl" });
  });

  test("trailing tier 1: peak +15 → jual saat turun ke ≤ +9", () => {
    const s = newExitState(1, 0);
    expect(evaluateExit(cfg, s, tick(S, 1.15)).type).toBe("hold");
    expect(evaluateExit(cfg, s, tick(2 * S, 1.1)).type).toBe("hold");
    expect(evaluateExit(cfg, s, tick(3 * S, 1.085))).toMatchObject({ type: "sell", reason: "trailing" });
  });

  test("TP ladder: langkah 1 jual 40% posisi awal, langkah 2 jual 30% posisi awal", () => {
    const s = newExitState(1, 0);
    const a = evaluateExit(cfg, s, tick(S, 1.26));
    expect(a).toMatchObject({ type: "sell", reason: "take_profit", ladderStep: 0 });
    if (a.type !== "sell") throw new Error();
    expect(a.fracOfRemaining).toBeCloseTo(0.4);
    applySell(s, a);
    expect(s.soldFrac).toBeCloseTo(0.4);
    const b = evaluateExit(cfg, s, tick(2 * S, 1.61));
    if (b.type !== "sell") throw new Error("harus jual");
    expect(b.reason).toBe("take_profit");
    expect(b.fracOfRemaining).toBeCloseTo(0.3 / 0.6); // 30% awal dari sisa 60%
    applySell(s, b);
    expect(s.soldFrac).toBeCloseTo(0.7);
    expect(s.ladderDone).toBe(2);
  });

  test("break-even: setelah peak ≥ +20, turun ke ≤ +2 → jual (trailing tier 1 belum memicu karena loncat)", () => {
    const c = ExitConfig.parse({ ...cfg, trailing: undefined, take_profit_ladder: [] });
    const s = newExitState(1, 0);
    evaluateExit(c, s, tick(S, 1.22));
    expect(s.breakEvenArmed).toBe(true);
    expect(evaluateExit(c, s, tick(2 * S, 1.05)).type).toBe("hold");
    expect(evaluateExit(c, s, tick(3 * S, 1.019))).toMatchObject({ type: "sell", reason: "break_even" });
  });

  test("momentum gagal, stale, max hold", () => {
    const c = ExitConfig.parse({
      hard_sl_pct: -50,
      momentum_fail: { within_sec: 90, min_gain_pct: 5 },
      max_hold_sec: 600,
      stale: { no_new_high_sec: 300, max_pnl_pct: 5 },
    });
    const s1 = newExitState(1, 0);
    expect(evaluateExit(c, s1, tick(60 * S, 1.02)).type).toBe("hold");
    expect(evaluateExit(c, s1, tick(91 * S, 1.02))).toMatchObject({ reason: "momentum_fail" });

    const s2 = newExitState(1, 0);
    evaluateExit(c, s2, tick(10 * S, 1.06)); // lolos momentum
    expect(evaluateExit(c, s2, tick(311 * S, 1.03))).toMatchObject({ reason: "stale" });

    const c2 = ExitConfig.parse({ hard_sl_pct: -50, max_hold_sec: 600 });
    const s3 = newExitState(1, 0);
    expect(evaluateExit(c2, s3, tick(600 * S, 1.3))).toMatchObject({ reason: "max_hold" });
  });
});

const trade = (await loadConfig("trade")).data;
const base = (o: Partial<RiskState> = {}): RiskState => ({
  now: Date.UTC(2026, 9, 17, 2, 0),
  killed: false,
  open: [],
  dailyPnlSol: 0,
  tradesToday: 0,
  recentWins: [],
  lastEntryAt: new Map(),
  lastCloseAt: null,
  freeSol: 2,
  ...o,
});
const req = { profile: "p", mint: "M", sizeSol: 0.1 };

describe("risk manager", () => {
  test("lolos saat kondisi normal", () => {
    expect(checkRisk(trade, base(), req)).toEqual({ ok: true, reasons: [], sizeSol: 0.1 });
  });

  test("kill switch, posisi sama, cooldown, daily loss", () => {
    const r = checkRisk(
      trade,
      base({
        killed: true,
        open: [{ profile: "p", mint: "M", sizeSol: 0.1 }],
        lastEntryAt: new Map([["M", Date.UTC(2026, 9, 17, 1, 50)]]),
        dailyPnlSol: -0.31,
      }),
      req,
    );
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(["kill_switch", "already_in_position", "reentry_cooldown", "daily_max_loss"]);
  });

  test("profit lock halve_size memotong ukuran", () => {
    expect(checkRisk(trade, base({ dailyPnlSol: 0.7 }), req).sizeSol).toBeCloseTo(0.05);
  });

  test("loss beruntun → jeda, setelah jeda lewat → boleh", () => {
    const now = Date.UTC(2026, 9, 17, 2, 0);
    const losses = [false, false, false, false, false];
    expect(
      checkRisk(trade, base({ recentWins: losses, lastCloseAt: now - 5 * 60_000 }), req).reasons,
    ).toContain("consecutive_losses_pause");
    expect(checkRisk(trade, base({ recentWins: losses, lastCloseAt: now - 31 * 60_000 }), req).ok).toBe(true);
  });

  test("exposure & saldo minimum", () => {
    const open = Array.from({ length: 5 }, (_, i) => ({ profile: `x${i}`, mint: `M${i}`, sizeSol: 0.2 }));
    expect(checkRisk(trade, base({ open }), req).reasons).toContain("max_exposure");
    expect(checkRisk(trade, base({ freeSol: 0.2 }), req).reasons).toContain("insufficient_balance");
  });

  test("jam trading (lewat tengah malam didukung)", () => {
    const t = TradeConfig.parse({ ...trade, trading_hours_utc: { enabled: true, allow: ["22:00-02:00"] } });
    expect(checkRisk(t, base({ now: Date.UTC(2026, 9, 17, 23, 0) }), req).ok).toBe(true);
    expect(checkRisk(t, base({ now: Date.UTC(2026, 9, 17, 3, 0) }), req).reasons).toContain(
      "outside_trading_hours",
    );
  });
});
