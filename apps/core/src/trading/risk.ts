import type { TradeConfig } from "@memebot/shared";

/**
 * Risk manager (docs/05 §1) — gerbang terakhir sebelum entry. Murni: semua state dikirim lewat argumen
 * supaya bisa dites dan dipakai ulang di replay.
 */

export interface RiskState {
  now: number;
  killed: boolean;
  /** posisi terbuka: profile, mint, SOL yang dipakai */
  open: { profile: string; mint: string; sizeSol: number }[];
  /** PnL realisasi hari ini (UTC) dalam SOL */
  dailyPnlSol: number;
  tradesToday: number;
  /** hasil posisi tertutup terbaru, terbaru dulu (true = untung) */
  recentWins: boolean[];
  /** waktu entry terakhir per mint */
  lastEntryAt: Map<string, number>;
  /** waktu close terakhir (untuk jeda setelah loss beruntun) */
  lastCloseAt: number | null;
  /** saldo paper/live: bankroll + PnL realisasi − SOL di posisi terbuka */
  freeSol: number;
}

export interface RiskVerdict {
  ok: boolean;
  reasons: string[];
  /** ukuran akhir (bisa dipotong profit-lock) */
  sizeSol: number;
}

function inHours(now: number, ranges: string[]): boolean {
  const d = new Date(now);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return ranges.some((r) => {
    const [a, b] = r.split("-") as [string, string];
    const [ah, am] = a.split(":").map(Number) as [number, number];
    const [bh, bm] = b.split(":").map(Number) as [number, number];
    const from = ah * 60 + am;
    const to = bh * 60 + bm;
    return from <= to ? mins >= from && mins < to : mins >= from || mins < to; // dukung rentang lewat tengah malam
  });
}

export function checkRisk(
  cfg: TradeConfig,
  s: RiskState,
  req: { profile: string; mint: string; sizeSol: number },
): RiskVerdict {
  const reasons: string[] = [];
  const L = cfg.limits;
  let size = Math.min(req.sizeSol, L.max_position_sol);

  if (s.killed) reasons.push("kill_switch");
  if (s.open.length >= L.max_open_positions) reasons.push("max_open_positions");
  if (s.open.filter((p) => p.profile === req.profile).length >= L.max_open_per_profile)
    reasons.push("max_open_per_profile");
  if (L.no_averaging_down && s.open.some((p) => p.mint === req.mint)) reasons.push("already_in_position");
  const last = s.lastEntryAt.get(req.mint);
  if (last !== undefined && s.now - last < L.reentry_cooldown_min * 60_000) reasons.push("reentry_cooldown");
  if (s.tradesToday >= L.max_trades_per_day) reasons.push("max_trades_per_day");

  // limit harian
  if (s.dailyPnlSol <= -cfg.daily.max_loss_sol) reasons.push("daily_max_loss");
  if (cfg.daily.profit_lock_sol !== undefined && s.dailyPnlSol >= cfg.daily.profit_lock_sol) {
    if (cfg.daily.profit_lock_action === "stop") reasons.push("daily_profit_lock");
    else if (cfg.daily.profit_lock_action === "halve_size") size /= 2;
  }

  // jam trading
  if (cfg.trading_hours_utc.enabled && !inHours(s.now, cfg.trading_hours_utc.allow))
    reasons.push("outside_trading_hours");

  // loss beruntun → jeda
  const cb = cfg.circuit_breakers.consecutive_losses;
  const streak = s.recentWins.slice(0, cb.n);
  if (
    streak.length >= cb.n &&
    streak.every((w) => !w) &&
    s.lastCloseAt !== null &&
    s.now - s.lastCloseAt < cb.pause_min * 60_000
  )
    reasons.push("consecutive_losses_pause");

  // exposure & saldo
  const exposure = s.open.reduce((a, p) => a + p.sizeSol, 0);
  if (exposure + size > L.max_exposure_sol) reasons.push("max_exposure");
  if (s.freeSol - size < cfg.bankroll.min_sol_reserve) reasons.push("insufficient_balance");

  return { ok: reasons.length === 0, reasons, sizeSol: size };
}
