import type { ExitConfig } from "@memebot/shared";

/**
 * Exit engine (docs/04 §5) — fungsi murni: state posisi + tick → aksi.
 * PnL dihitung dari NILAI JUAL EXECUTABLE (harga × (1 − biaya exit estimasi)) relatif ke harga entry efektif
 * (sudah termasuk fee entry). Semua persentase dalam "poin persen" (contoh: trailing aktif di +10 dengan jarak 5
 * → peak +50 berarti batas exit +45, sesuai post referensi).
 */

export interface ExitState {
  /** SOL per 1 token (UI units), termasuk biaya entry */
  entryPrice: number;
  openedAt: number;
  peakPnlPct: number;
  lastHighAt: number;
  /** jumlah langkah TP ladder yang sudah dieksekusi */
  ladderDone: number;
  breakEvenArmed: boolean;
  /** porsi posisi awal yang sudah terjual (0..1) */
  soldFrac: number;
}

export interface ExitTick {
  ts: number;
  /** SOL per 1 token (UI units), harga pasar */
  price: number;
  /** estimasi biaya exit (%), mis. price impact + fee pool + platform */
  exitCostPct: number;
}

export type ExitReason =
  | "hard_sl"
  | "break_even"
  | "trailing"
  | "take_profit"
  | "momentum_fail"
  | "stale"
  | "max_hold"
  | "manual"
  | "panic";

export type ExitAction =
  | { type: "hold"; pnlPct: number }
  | {
      type: "sell";
      reason: ExitReason /** porsi dari SISA posisi (0..1] */;
      fracOfRemaining: number;
      pnlPct: number;
      ladderStep?: number;
    };

export function newExitState(entryPrice: number, openedAt: number): ExitState {
  return {
    entryPrice,
    openedAt,
    peakPnlPct: 0,
    lastHighAt: openedAt,
    ladderDone: 0,
    breakEvenArmed: false,
    soldFrac: 0,
  };
}

export function executablePnlPct(state: ExitState, tick: ExitTick): number {
  const exitPrice = tick.price * (1 - tick.exitCostPct / 100);
  return (exitPrice / state.entryPrice - 1) * 100;
}

/** Update peak/break-even dan kembalikan aksi. State dimutasi (peak, lastHighAt, breakEvenArmed). */
export function evaluateExit(cfg: ExitConfig, state: ExitState, tick: ExitTick): ExitAction {
  const pnl = executablePnlPct(state, tick);
  if (pnl > state.peakPnlPct) {
    state.peakPnlPct = pnl;
    state.lastHighAt = tick.ts;
  }
  if (cfg.break_even && state.peakPnlPct >= cfg.break_even.activate_at_pct) state.breakEvenArmed = true;

  const sellAll = (reason: ExitReason): ExitAction => ({
    type: "sell",
    reason,
    fracOfRemaining: 1,
    pnlPct: pnl,
  });

  // 1) hard stop loss
  if (pnl <= cfg.hard_sl_pct) return sellAll("hard_sl");

  // 2) break-even stop
  if (cfg.break_even && state.breakEvenArmed && pnl <= cfg.break_even.lock_pct) return sellAll("break_even");

  // 3) trailing (tier tertinggi yang sudah aktif berdasarkan peak)
  if (cfg.trailing && "tiers" in cfg.trailing) {
    let distance: number | null = null;
    for (const t of cfg.trailing.tiers) if (state.peakPnlPct >= t.activate_at_pct) distance = t.distance_pct;
    if (distance !== null && pnl <= state.peakPnlPct - distance) return sellAll("trailing");
  }

  // 4) take-profit ladder (sell_pct = % dari posisi AWAL; langkah 100% = jual sisa)
  const step = cfg.take_profit_ladder[state.ladderDone];
  if (step && pnl >= step.at_pct) {
    const remaining = 1 - state.soldFrac;
    const want = step.sell_pct >= 100 ? remaining : Math.min(remaining, step.sell_pct / 100);
    const frac = remaining > 0 ? Math.min(1, want / remaining) : 1;
    return {
      type: "sell",
      reason: "take_profit",
      fracOfRemaining: frac,
      pnlPct: pnl,
      ladderStep: state.ladderDone,
    };
  }

  const age = tick.ts - state.openedAt;

  // 5) momentum gagal: belum pernah naik min_gain dalam within_sec
  if (
    cfg.momentum_fail &&
    age >= cfg.momentum_fail.within_sec * 1000 &&
    state.peakPnlPct < cfg.momentum_fail.min_gain_pct
  )
    return sellAll("momentum_fail");

  // 6) stale: tidak ada high baru & PnL kecil
  if (
    cfg.stale &&
    tick.ts - state.lastHighAt >= cfg.stale.no_new_high_sec * 1000 &&
    pnl <= cfg.stale.max_pnl_pct
  )
    return sellAll("stale");

  // 7) max hold
  if (age >= cfg.max_hold_sec * 1000) return sellAll("max_hold");

  return { type: "hold", pnlPct: pnl };
}

/** Catat hasil penjualan ke state (dipanggil setelah sell berhasil). */
export function applySell(state: ExitState, action: Extract<ExitAction, { type: "sell" }>) {
  const remaining = 1 - state.soldFrac;
  state.soldFrac = Math.min(1, state.soldFrac + remaining * action.fracOfRemaining);
  if (action.reason === "take_profit" && action.ladderStep !== undefined)
    state.ladderDone = action.ladderStep + 1;
}
