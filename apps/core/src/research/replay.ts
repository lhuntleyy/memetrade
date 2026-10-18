import type { Db } from "@memebot/db";
import { ExitConfig, type FilterRule, type StrategyConfig } from "@memebot/shared";
import { despike } from "../market/despike.ts";
import { evaluateFilters } from "../strategy/rules.ts";
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
  /**
   * Kalibrasi dari paper trading: tambahan rugi (poin %) per alasan exit, mis. hard_sl = gap saat dump
   * (harga DexScreener tertinggal, quote jual asli jauh lebih rendah). Positif = lebih buruk.
   */
  exitGapPct?: Partial<Record<string, number>>;
  /**
   * Batasi profit per penjualan di level TP tertinggi (+ capTpSlackPct). Lonjakan antar-tick DexScreener (sebagian
   * palsu) membuat replay "menjual" jauh di atas TP, padahal paper (quote tiap ±4 dtk) rata-rata keluar ≈ level TP.
   */
  capProfitAtTp?: boolean;
  capTpSlackPct?: number;
  /** potongan rata (poin %) per trade: selisih rata-rata paper vs replay yang tidak dijelaskan model (rug, data basi) */
  flatHaircutPct?: number;
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
      let pnl = a.pnlPct;
      if (o.capProfitAtTp && exit.take_profit_ladder.length) {
        const cap = Math.max(...exit.take_profit_ladder.map((l) => l.at_pct)) + (o.capTpSlackPct ?? 0);
        pnl = Math.min(pnl, cap);
      }
      realized += (before - (1 - state.soldFrac)) * (pnl - (o.exitGapPct?.[a.reason] ?? 0));
      if (state.soldFrac >= 0.999)
        return {
          mint: c.mint,
          profile: c.profile,
          entryTs: first.ts,
          exitTs: t.ts,
          pnlPct: realized - (o.flatHaircutPct ?? 0),
          reason: a.reason,
          peakPct: state.peakPnlPct,
        };
    }
  }
  // data habis sebelum exit → tutup di tick terakhir
  const rest = 1 - state.soldFrac;
  // data harga berhenti sebelum exit: sering berarti pair hilang / likuiditas ditarik (rug) → gap kalibrasi "data_end"
  const lastPnl =
    ((last.price * (1 - o.exitCostPct / 100)) / state.entryPrice - 1) * 100 - (o.exitGapPct?.data_end ?? 0);
  return {
    mint: c.mint,
    profile: c.profile,
    entryTs: first.ts,
    exitTs: last.ts,
    pnlPct: realized + rest * lastPnl - (o.flatHaircutPct ?? 0),
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

/**
 * "What-if filter": ambil token yang pernah dievaluasi (beserta fitur yang tersimpan di decisions), saring ulang
 * dengan rule baru, lalu replay. Dipakai untuk menguji perubahan filter memakai data lampau.
 */
export async function loadRefilteredData(
  db: Db,
  req: {
    triggerSources: string[];
    hours: number;
    horizonSec: number;
    filters: FilterRule[];
    defaults: StrategyConfig["defaults"];
  },
) {
  const rows = (await db`
    SELECT DISTINCT ON (d.mint, d.trigger_ts) d.mint, d.ts, d.features,
           (SELECT bool_and(s.passed) FROM decisions s WHERE s.mint = d.mint AND s.trigger_ts = d.trigger_ts AND s.stage = 'security') AS sec_ok
    FROM decisions d
    WHERE d.stage = 'filter' AND d.ts > now() - make_interval(hours => ${req.hours})
      AND d.trigger_source IN ${db(req.triggerSources)}
    ORDER BY d.mint, d.trigger_ts, d.ts`) as {
    mint: string;
    ts: Date;
    features: Record<string, number | string | boolean | null>;
    sec_ok: boolean | null;
  }[];
  const candidates: ReplayCandidate[] = [];
  const rejected: Record<string, number> = {};
  for (const r of rows) {
    if (r.sec_ok === false) continue;
    const f = evaluateFilters(req.filters, r.features ?? {}, req.defaults);
    if (f.passed) candidates.push({ mint: r.mint, profile: "refilter", ts: new Date(r.ts).getTime() });
    else for (const x of f.failed) rejected[x] = (rejected[x] ?? 0) + 1;
  }
  const ticks = new Map<string, Tick[]>();
  if (candidates.length) {
    const mints = [...new Set(candidates.map((c) => c.mint))];
    const from = new Date(Math.min(...candidates.map((c) => c.ts)));
    const to = new Date(Math.max(...candidates.map((c) => c.ts)) + req.horizonSec * 1000);
    const tr = (await db`
      SELECT mint, ts, price_sol FROM ticks
      WHERE mint IN ${db(mints)} AND ts BETWEEN ${from} AND ${to} AND price_sol > 0 ORDER BY mint, ts`) as {
      mint: string;
      ts: Date;
      price_sol: number;
    }[];
    for (const t of tr) {
      const list = ticks.get(t.mint) ?? [];
      list.push({ ts: new Date(t.ts).getTime(), price: Number(t.price_sol) });
      ticks.set(t.mint, list);
    }
    for (const [m, list] of ticks) ticks.set(m, despike(list, m));
  }
  return { evaluated: rows.length, candidates, ticks, rejected };
}

export interface WalkForwardFold {
  fold: number;
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
  /** parameter terbaik di data latih (null kalau trade latih kurang) */
  best: { tp: number; sl: number; trainExpectancyPct: number | null; trainTrades: number } | null;
  /** hasil parameter terbaik di data uji (out-of-sample) */
  test: ReplayMetrics | null;
  /** hasil exit config sekarang di data uji yang sama (pembanding) */
  testCurrent: ReplayMetrics;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** gabungan semua trade out-of-sample dengan parameter hasil optimasi */
  oos: ReplayMetrics;
  /** gabungan out-of-sample exit config sekarang */
  oosCurrent: ReplayMetrics;
  /** seberapa sering parameter terbaik berubah antar fold (stabilitas) */
  distinctBest: number;
}

/**
 * Walk-forward (anchored): kandidat diurutkan menurut waktu lalu dibagi `folds + 1` segmen sama besar.
 * Fold i: latih di segmen 0..i-1 (expanding), pilih TP×SL dengan expectancy tertinggi (min `minTrades` trade),
 * uji di segmen i. Hasil out-of-sample digabung → perkiraan performa yang lebih jujur daripada sweep biasa.
 */
export function walkForward(
  data: { candidates: ReplayCandidate[]; ticks: Map<string, Tick[]> },
  base: ExitConfig,
  tps: number[],
  sls: number[],
  options: ReplayOptions,
  folds = 4,
  minTrades = 10,
): WalkForwardResult {
  const sorted = [...data.candidates].sort((a, b) => a.ts - b.ts);
  const segSize = Math.max(1, Math.floor(sorted.length / (folds + 1)));
  const seg = (i: number) => sorted.slice(i * segSize, i === folds ? sorted.length : (i + 1) * segSize);
  const out: WalkForwardFold[] = [];
  const oosTrades: ReplayTrade[] = [];
  const oosCurrentTrades: ReplayTrade[] = [];
  let oosCandidates = 0;
  for (let i = 1; i <= folds; i++) {
    const train = sorted.slice(0, i * segSize);
    const test = seg(i);
    if (train.length === 0 || test.length === 0) continue;
    const trainData = { candidates: train, ticks: data.ticks };
    const testData = { candidates: test, ticks: data.ticks };
    const cells = sweepTpSl(trainData, base, tps, sls, options).filter(
      (c) => c.m.trades >= minTrades && c.m.expectancyPct !== null,
    );
    const bestCell = cells.sort((a, b) => (b.m.expectancyPct ?? -1e9) - (a.m.expectancyPct ?? -1e9))[0];
    const current = runReplay(testData, base, options);
    oosCurrentTrades.push(...current.trades);
    oosCandidates += test.length;
    let testM: ReplayMetrics | null = null;
    if (bestCell) {
      const exit = ExitConfig.parse({
        ...base,
        hard_sl_pct: -Math.abs(bestCell.sl),
        take_profit_ladder: [{ at_pct: bestCell.tp, sell_pct: 100 }],
      });
      const r = runReplay(testData, exit, options);
      testM = r.metrics;
      oosTrades.push(...r.trades);
    }
    out.push({
      fold: i,
      trainFrom: train[0]!.ts,
      trainTo: train[train.length - 1]!.ts,
      testFrom: test[0]!.ts,
      testTo: test[test.length - 1]!.ts,
      best: bestCell
        ? {
            tp: bestCell.tp,
            sl: bestCell.sl,
            trainExpectancyPct: bestCell.m.expectancyPct,
            trainTrades: bestCell.m.trades,
          }
        : null,
      test: testM,
      testCurrent: current.metrics,
    });
  }
  return {
    folds: out,
    oos: metrics(oosTrades, oosCandidates),
    oosCurrent: metrics(oosCurrentTrades, oosCandidates),
    distinctBest: new Set(out.filter((f) => f.best).map((f) => `${f.best!.tp}/${f.best!.sl}`)).size,
  };
}
