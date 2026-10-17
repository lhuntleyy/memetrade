import type { Db } from "@memebot/db";
import { ExitConfig } from "@memebot/shared";
import { despike } from "../market/despike.ts";
import { applySell, evaluateExit, newExitState } from "../trading/exit-engine.ts";

/**
 * Replay / backtest Fase 4 (docs/09 §3): jalankan exit engine yang SAMA dengan paper/live di atas data tick
 * rekaman. Entry = tick pertama setelah (waktu keputusan + latency), biaya entry/exit = persen tetap (kalibrasi
 * dari fill paper). Dipakai untuk sweep parameter (TP × SL) tanpa menunggu paper trading.
 */

export interface ReplayCandidate {
  mint: string;
  profile: string;
  ts: number;
}

export interface Tick {
  ts: number;
  price: number;
}

export interface ReplayOptions {
  latencySec: number;
  entryCostPct: number;
  exitCostPct: number;
}

export interface ReplayTrade {
  mint: string;
  profile: string;
  entryTs: number;
  exitTs: number;
  pnlPct: number;
  reason: string;
  peakPct: number;
}

export interface ReplayMetrics {
  candidates: number;
  trades: number;
  noData: number;
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  expectancyPct: number | null;
  /** median PnL per trade — tahan outlier */
  medianPct: number | null;
  totalPct: number;
  maxDrawdownPct: number;
  reasons: Record<string, number>;
}

/** Simulasi satu kandidat. null kalau tidak ada tick setelah waktu entry. */
export function simulate(
  c: ReplayCandidate,
  ticks: Tick[],
  exit: ExitConfig,
  o: ReplayOptions,
): ReplayTrade | null {
  const entryAt = c.ts + o.latencySec * 1000;
  const i0 = ticks.findIndex((t) => t.ts >= entryAt && t.price > 0 && Number.isFinite(t.price));
  if (i0 < 0) return null;
  const first = ticks[i0]!;
  const state = newExitState(first.price * (1 + o.entryCostPct / 100), first.ts);
  let realized = 0; // jumlah (fraksi posisi × pnl%) yang sudah terjual
  let last = first;
  for (let i = i0; i < ticks.length; i++) {
    const t = ticks[i]!;
    if (!(t.price > 0) || !Number.isFinite(t.price)) continue;
    last = t;
    const a = evaluateExit(exit, state, { ts: t.ts, price: t.price, exitCostPct: o.exitCostPct });
    if (a.type === "sell") {
      const before = 1 - state.soldFrac;
      applySell(state, a);
      realized += (before - (1 - state.soldFrac)) * a.pnlPct;
      if (state.soldFrac >= 0.999)
        return {
          mint: c.mint,
          profile: c.profile,
          entryTs: first.ts,
          exitTs: t.ts,
          pnlPct: realized,
          reason: a.reason,
          peakPct: state.peakPnlPct,
        };
    }
  }
  // data habis sebelum exit → tutup di tick terakhir
  const rest = 1 - state.soldFrac;
  const lastPnl = ((last.price * (1 - o.exitCostPct / 100)) / state.entryPrice - 1) * 100;
  return {
    mint: c.mint,
    profile: c.profile,
    entryTs: first.ts,
    exitTs: last.ts,
    pnlPct: realized + rest * lastPnl,
    reason: "data_end",
    peakPct: state.peakPnlPct,
  };
}

function median(xs: number[]) {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

export function metrics(trades: ReplayTrade[], candidates: number): ReplayMetrics {
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const sum = (xs: ReplayTrade[]) => xs.reduce((a, t) => a + t.pnlPct, 0);
  const reasons: Record<string, number> = {};
  for (const t of trades) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1;
  // drawdown pada equity kumulatif (ukuran posisi sama), urut waktu exit
  let eq = 0;
  let peak = 0;
  let mdd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTs - b.exitTs)) {
    eq += t.pnlPct;
    peak = Math.max(peak, eq);
    mdd = Math.max(mdd, peak - eq);
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    candidates,
    trades: trades.length,
    noData: candidates - trades.length,
    winRate: trades.length ? r((wins.length / trades.length) * 100) : null,
    avgWinPct: wins.length ? r(sum(wins) / wins.length) : null,
    avgLossPct: losses.length ? r(sum(losses) / losses.length) : null,
    profitFactor: losses.length && sum(losses) !== 0 ? r(sum(wins) / Math.abs(sum(losses))) : null,
    expectancyPct: trades.length ? r(sum(trades) / trades.length) : null,
    medianPct: trades.length ? r(median(trades.map((t) => t.pnlPct))) : null,
    totalPct: r(sum(trades)),
    maxDrawdownPct: r(mdd),
    reasons,
  };
}

export interface ReplayRequest {
  profile: string | "all";
  hours: number;
  /** passed = hanya token yang lolos security+filter; evaluated = semua yang dievaluasi (baseline tanpa filter) */
  universe: "passed" | "evaluated";
  exit: ExitConfig;
  options: ReplayOptions;
  maxCandidates?: number;
}

/** Ambil kandidat + tick dari DB (sekali) — dipakai ulang untuk banyak varian exit. */
export async function loadReplayData(
  db: Db,
  req: Omit<ReplayRequest, "exit" | "options"> & { horizonSec: number },
) {
  const rows = await db`
    WITH f AS (
      SELECT profile, mint, trigger_ts, min(ts) AS ts,
             bool_and(passed) FILTER (WHERE stage = 'filter') AS filter_ok,
             bool_and(passed) FILTER (WHERE stage = 'security') AS sec_ok
      FROM decisions
      WHERE ts > now() - make_interval(hours => ${req.hours}) AND stage IN ('filter', 'security')
        AND (${req.profile} = 'all' OR profile = ${req.profile})
      GROUP BY 1, 2, 3
    )
    SELECT profile, mint, ts FROM f
    WHERE filter_ok IS NOT NULL AND (${req.universe} = 'evaluated' OR (filter_ok AND sec_ok))
    ORDER BY ts DESC LIMIT ${req.maxCandidates ?? 2000}`;
  const candidates: ReplayCandidate[] = rows.map((r: { profile: string; mint: string; ts: Date }) => ({
    profile: r.profile,
    mint: r.mint,
    ts: new Date(r.ts).getTime(),
  }));
  const ticks = new Map<string, Tick[]>();
  if (candidates.length) {
    const mints = [...new Set(candidates.map((c) => c.mint))];
    const from = new Date(Math.min(...candidates.map((c) => c.ts)));
    const to = new Date(Math.max(...candidates.map((c) => c.ts)) + req.horizonSec * 1000);
    const tr = await db`
      SELECT mint, ts, price_sol FROM ticks
      WHERE mint IN ${db(mints)} AND ts BETWEEN ${from} AND ${to} AND price_sol > 0 AND price_sol <> 'NaN' 
      ORDER BY mint, ts`;
    for (const t of tr as { mint: string; ts: Date; price_sol: number }[]) {
      let list = ticks.get(t.mint);
      if (!list) {
        list = [];
        ticks.set(t.mint, list);
      }
      list.push({ ts: new Date(t.ts).getTime(), price: Number(t.price_sol) });
    }
    // data lama bisa berisi spike palsu DexScreener → bersihkan dengan filter yang sama dengan tracker
    for (const [m, list] of ticks) ticks.set(m, despike(list, m));
  }
  return { candidates, ticks };
}

export function runReplay(
  data: { candidates: ReplayCandidate[]; ticks: Map<string, Tick[]> },
  exit: ExitConfig,
  options: ReplayOptions,
) {
  const trades: ReplayTrade[] = [];
  for (const c of data.candidates) {
    const t = simulate(c, data.ticks.get(c.mint) ?? [], exit, options);
    if (t) trades.push(t);
  }
  return { metrics: metrics(trades, data.candidates.length), trades };
}

/** Sweep TP (jual 100%) × SL; trailing opsional tetap. Hasil per sel = metrik ringkas. */
export function sweepTpSl(
  data: { candidates: ReplayCandidate[]; ticks: Map<string, Tick[]> },
  base: ExitConfig,
  tps: number[],
  sls: number[],
  options: ReplayOptions,
) {
  const cells: { tp: number; sl: number; m: ReplayMetrics }[] = [];
  for (const tp of tps) {
    for (const sl of sls) {
      const exit = ExitConfig.parse({
        ...base,
        hard_sl_pct: -Math.abs(sl),
        take_profit_ladder: [{ at_pct: tp, sell_pct: 100 }],
      });
      cells.push({ tp, sl, m: runReplay(data, exit, options).metrics });
    }
  }
  return cells;
}
