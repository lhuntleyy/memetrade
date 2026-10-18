import type { Db } from "@memebot/db";
import type { ExitConfig, FilterRule } from "@memebot/shared";
import { despike } from "../market/despike.ts";
import { type ReplayOptions, simulate, type Tick } from "./replay.ts";

/**
 * Analisa fitur → hasil trade. Target = PnL replay exit (setelah biaya) kalau masuk saat token dievaluasi,
 * bukan sekadar "harga sempat naik". Semua fungsi statistik murni supaya bisa dites.
 */

export type FeatureValue = number | string | boolean | null;

export interface DatasetRow {
  mint: string;
  source: string;
  ts: number;
  features: Record<string, FeatureValue>;
  /** PnL replay (%), null = tidak ada data harga setelah entry */
  pnl: number | null;
  /** puncak PnL selama posisi (replay) */
  peak: number | null;
  exitReason: string | null;
}

/** Fitur internal/duplikat yang tidak dianalisa. */
const SKIP = new Set([
  "_pair_found",
  "_ignored_null",
  "price_sol",
  "price_usd",
  "dex_id",
  "jup_liquidity_usd",
  "jup_mcap_usd",
]);

export async function loadDataset(
  db: Db,
  opts: {
    hours: number;
    exit: ExitConfig;
    replay: ReplayOptions;
    horizonSec: number;
    /** model biaya per baris (mis. dari cost probe per likuiditas); default = opts.replay */
    /** opsi replay per baris (biaya terukur per likuiditas + kalibrasi per sumber) */
    costFor?: (features: Record<string, FeatureValue>, source: string) => Partial<ReplayOptions>;
  },
): Promise<DatasetRow[]> {
  const rows = (await db`
    SELECT DISTINCT ON (d.mint, d.trigger_ts) d.mint, d.trigger_source AS source, d.ts, d.features,
           (SELECT bool_and(s.passed) FROM decisions s
             WHERE s.mint = d.mint AND s.trigger_ts = d.trigger_ts AND s.stage = 'security') AS sec_ok
    FROM decisions d
    WHERE d.stage = 'filter' AND d.ts > now() - make_interval(hours => ${opts.hours}) AND d.trigger_source IS NOT NULL
    ORDER BY d.mint, d.trigger_ts, d.ts`) as {
    mint: string;
    source: string;
    ts: Date;
    features: Record<string, FeatureValue>;
    sec_ok: boolean | null;
  }[];
  const usable = rows.filter((r) => r.sec_ok !== false); // token gagal security tidak akan pernah dibeli
  const ticks = new Map<string, Tick[]>();
  const mints = [...new Set(usable.map((r) => r.mint))];
  for (let i = 0; i < mints.length; i += 400) {
    const chunk = mints.slice(i, i + 400);
    const tr = (await db`
      SELECT mint, ts, price_sol FROM ticks
      WHERE mint IN ${db(chunk)} AND ts > now() - make_interval(hours => ${opts.hours + 2}) AND price_sol > 0
      ORDER BY mint, ts`) as { mint: string; ts: Date; price_sol: number }[];
    for (const t of tr) {
      const list = ticks.get(t.mint) ?? [];
      list.push({ ts: new Date(t.ts).getTime(), price: Number(t.price_sol) });
      ticks.set(t.mint, list);
    }
  }
  for (const [m, list] of ticks) ticks.set(m, despike(list, m));
  return usable.map((r) => {
    const ts = new Date(r.ts).getTime();
    const trade = simulate({ mint: r.mint, profile: r.source, ts }, ticks.get(r.mint) ?? [], opts.exit, {
      ...opts.replay,
      ...(opts.costFor ? opts.costFor(r.features ?? {}, r.source) : {}),
    });
    const features: Record<string, FeatureValue> = {};
    for (const [k, v] of Object.entries(r.features ?? {})) if (!SKIP.has(k)) features[k] = v;
    return {
      mint: r.mint,
      source: r.source,
      ts,
      features,
      pnl: trade ? trade.pnlPct : null,
      peak: trade ? trade.peakPct : null,
      exitReason: trade?.reason ?? null,
    };
  });
}

export interface GroupStats {
  n: number;
  meanPnl: number | null;
  medianPnl: number | null;
  winRate: number | null;
  /** % trade yang puncaknya ≥ +25% (sempat dekat target) */
  hit25: number | null;
  /** % trade yang kena stop loss */
  slRate: number | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function groupStats(rows: DatasetRow[]): GroupStats {
  const t = rows.filter((r) => r.pnl !== null);
  if (t.length === 0)
    return { n: 0, meanPnl: null, medianPnl: null, winRate: null, hit25: null, slRate: null };
  const p = t.map((r) => r.pnl!).sort((a, b) => a - b);
  const mid = Math.floor(p.length / 2);
  return {
    n: t.length,
    meanPnl: r1(p.reduce((a, b) => a + b, 0) / p.length),
    medianPnl: r1(p.length % 2 ? p[mid]! : (p[mid - 1]! + p[mid]!) / 2),
    winRate: r1((t.filter((r) => r.pnl! > 0).length / t.length) * 100),
    hit25: r1((t.filter((r) => (r.peak ?? 0) >= 25).length / t.length) * 100),
    slRate: r1((t.filter((r) => r.exitReason === "hard_sl").length / t.length) * 100),
  };
}

/** Fitur numerik yang terisi di minimal `minCoverage` baris. */
export function numericFeatures(rows: DatasetRow[], minCoverage = 0.3): string[] {
  const counts = new Map<string, number>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r.features))
      if (typeof v === "number" && Number.isFinite(v)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts]
    .filter(([, c]) => c >= rows.length * minCoverage)
    .map(([k]) => k)
    .sort();
}

const num = (r: DatasetRow, f: string) => {
  const v = r.features[f];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

function quantiles(values: number[], qs: number[]): number[] {
  const s = [...values].sort((a, b) => a - b);
  return qs.map((q) => s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!);
}

export interface Bucket {
  label: string;
  lo: number | null;
  hi: number | null;
  stats: GroupStats;
}

/** Bucket kuantil (default 5) + bucket "kosong" untuk nilai null. */
export function bucketize(rows: DatasetRow[], feature: string, n = 5): Bucket[] {
  const withVal = rows.filter((r) => num(r, feature) !== null && r.pnl !== null);
  const out: Bucket[] = [];
  if (withVal.length >= n * 5) {
    const edges = [
      ...new Set(
        quantiles(
          withVal.map((r) => num(r, feature)!),
          Array.from({ length: n + 1 }, (_, i) => i / n),
        ),
      ),
    ];
    for (let i = 0; i < edges.length - 1; i++) {
      const lo = edges[i]!;
      const hi = edges[i + 1]!;
      const last = i === edges.length - 2;
      const sub = withVal.filter((r) => {
        const v = num(r, feature)!;
        return v >= lo && (last ? v <= hi : v < hi);
      });
      out.push({ label: `${fmt(lo)} – ${fmt(hi)}`, lo, hi, stats: groupStats(sub) });
    }
  }
  const nulls = rows.filter((r) => num(r, feature) === null && r.pnl !== null);
  if (nulls.length) out.push({ label: "kosong", lo: null, hi: null, stats: groupStats(nulls) });
  return out;
}

function fmt(v: number) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${r1(v / 1e6)}jt`;
  if (a >= 1e3) return `${r1(v / 1e3)}rb`;
  return String(Math.round(v * 100) / 100);
}

/** Korelasi peringkat Spearman fitur ↔ PnL (baris dengan keduanya terisi). */
export function spearman(rows: DatasetRow[], feature: string): { rho: number | null; n: number } {
  const pairs = rows
    .map((r) => [num(r, feature), r.pnl] as const)
    .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
  if (pairs.length < 20) return { rho: null, n: pairs.length };
  const rank = (xs: number[]) => {
    const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
      for (let k = i; k <= j; k++) r[idx[k]![1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const a = rank(pairs.map((p) => p[0]));
  const b = rank(pairs.map((p) => p[1]));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (a[i]! - ma) * (b[i]! - mb);
    va += (a[i]! - ma) ** 2;
    vb += (b[i]! - mb) ** 2;
  }
  return { rho: va && vb ? Math.round((cov / Math.sqrt(va * vb)) * 1000) / 1000 : null, n: pairs.length };
}

/** Rule sederhana: fitur ≥ / ≤ ambang (null = tidak lolos — konsisten dengan on_null: reject). */
export interface Rule {
  field: string;
  op: "gte" | "lte";
  value: number;
}

export function passes(r: DatasetRow, rules: Rule[]): boolean {
  return rules.every((x) => {
    const v = num(r, x.field);
    return v !== null && (x.op === "gte" ? v >= x.value : v <= x.value);
  });
}

export const ruleLabel = (rules: Rule[]) =>
  rules.length
    ? rules.map((r) => `${r.field} ${r.op === "gte" ? "≥" : "≤"} ${fmt(r.value)}`).join(" & ")
    : "(tanpa filter)";

/**
 * Cari rule terbaik di `rows`: kandidat tunggal (ambang di kuantil 10–90%) lalu kombinasi 2 rule dari
 * top-K tunggal. Kriteria: mean PnL tertinggi dengan support minimal `minN` trade.
 */
export function searchRules(
  rows: DatasetRow[],
  features: string[],
  minN: number,
  topK = 8,
): { rules: Rule[]; stats: GroupStats }[] {
  const traded = rows.filter((r) => r.pnl !== null);
  const singles: { rules: Rule[]; stats: GroupStats }[] = [];
  for (const f of features) {
    const vals = traded.map((r) => num(r, f)).filter((v): v is number => v !== null);
    if (vals.length < minN) continue;
    for (const t of new Set(quantiles(vals, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]))) {
      for (const op of ["gte", "lte"] as const) {
        const rules = [{ field: f, op, value: t }];
        const st = groupStats(traded.filter((r) => passes(r, rules)));
        if (st.n >= minN) singles.push({ rules, stats: st });
      }
    }
  }
  singles.sort((a, b) => (b.stats.meanPnl ?? -1e9) - (a.stats.meanPnl ?? -1e9));
  const top = singles.slice(0, topK);
  const pairs: { rules: Rule[]; stats: GroupStats }[] = [];
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) {
      if (top[i]!.rules[0]!.field === top[j]!.rules[0]!.field) continue;
      const rules = [...top[i]!.rules, ...top[j]!.rules];
      const st = groupStats(traded.filter((r) => passes(r, rules)));
      if (st.n >= minN) pairs.push({ rules, stats: st });
    }
  return [...singles, ...pairs].sort((a, b) => (b.stats.meanPnl ?? -1e9) - (a.stats.meanPnl ?? -1e9));
}

export interface RuleWalkForward {
  folds: {
    fold: number;
    chosen: string;
    trainMean: number | null;
    trainN: number;
    test: GroupStats;
    baseline: GroupStats;
  }[];
  oos: GroupStats;
  oosBaseline: GroupStats;
  /** rule yang paling sering terpilih */
  mostChosen: string | null;
}

/** Walk-forward pemilihan rule (anchored): pilih rule terbaik di data lampau, uji di periode berikutnya. */
export function walkForwardRules(
  rows: DatasetRow[],
  features: string[],
  folds: number,
  minN: number,
): RuleWalkForward {
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);
  const size = Math.max(1, Math.floor(sorted.length / (folds + 1)));
  const out: RuleWalkForward["folds"] = [];
  const oosRows: DatasetRow[] = [];
  const baseRows: DatasetRow[] = [];
  const counts = new Map<string, number>();
  for (let i = 1; i <= folds; i++) {
    const train = sorted.slice(0, i * size);
    const test = sorted.slice(i * size, i === folds ? sorted.length : (i + 1) * size);
    if (!test.length) continue;
    const best = searchRules(train, features, minN)[0];
    const rules = best?.rules ?? [];
    const label = ruleLabel(rules);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    const picked = test.filter((r) => passes(r, rules));
    oosRows.push(...picked);
    baseRows.push(...test);
    out.push({
      fold: i,
      chosen: label,
      trainMean: best?.stats.meanPnl ?? null,
      trainN: best?.stats.n ?? 0,
      test: groupStats(picked),
      baseline: groupStats(test),
    });
  }
  const mostChosen = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { folds: out, oos: groupStats(oosRows), oosBaseline: groupStats(baseRows), mostChosen };
}

/** Rule → FilterRule config (untuk usulan profile). */
export function toFilterRules(rules: Rule[]): FilterRule[] {
  return rules.map((r) => ({ field: r.field, op: r.op, value: Math.round(r.value * 100) / 100 }));
}

export interface PathCandidate {
  mint: string;
  source: string;
  t0: number;
}

/** Semua trigger dengan jalur harga selesai (lebih banyak sampel daripada token yang dievaluasi). */
export async function loadPathCandidates(db: Db, hours: number, horizonMin: number) {
  const rows = (await db`
    SELECT mint, source, t0 FROM tracked_paths
    WHERE completed_at IS NOT NULL AND n_ticks > 0 AND t0 > now() - make_interval(hours => ${hours})`) as {
    mint: string;
    source: string;
    t0: Date;
  }[];
  const cands: PathCandidate[] = rows.map((r) => ({
    mint: r.mint,
    source: r.source,
    t0: new Date(r.t0).getTime(),
  }));
  const ticks = new Map<string, Tick[]>();
  const mints = [...new Set(cands.map((c) => c.mint))];
  for (let i = 0; i < mints.length; i += 400) {
    const chunk = mints.slice(i, i + 400);
    const tr = (await db`
      SELECT mint, ts, price_sol FROM ticks
      WHERE mint IN ${db(chunk)} AND ts > now() - make_interval(hours => ${hours + horizonMin / 60 + 2}) AND price_sol > 0
      ORDER BY mint, ts`) as { mint: string; ts: Date; price_sol: number }[];
    for (const t of tr) {
      const list = ticks.get(t.mint) ?? [];
      list.push({ ts: new Date(t.ts).getTime(), price: Number(t.price_sol) });
      ticks.set(t.mint, list);
    }
  }
  for (const [m, list] of ticks) ticks.set(m, despike(list, m));
  return { cands, ticks };
}

/** Hasil replay kalau masuk `delayMin` menit setelah trigger (tanpa filter). */
export function delayRows(
  data: { cands: PathCandidate[]; ticks: Map<string, Tick[]> },
  delayMin: number,
  exit: ExitConfig,
  replay: ReplayOptions,
): DatasetRow[] {
  return data.cands.map((c) => {
    const ts = c.t0 + delayMin * 60_000;
    const t = simulate({ mint: c.mint, profile: c.source, ts }, data.ticks.get(c.mint) ?? [], exit, replay);
    return {
      mint: c.mint,
      source: c.source,
      ts,
      features: {},
      pnl: t?.pnlPct ?? null,
      peak: t?.peakPct ?? null,
      exitReason: t?.reason ?? null,
    };
  });
}

/** Walk-forward pemilihan delay: pilih delay dengan mean PnL terbaik di data lampau, uji di periode berikutnya. */
export function walkForwardDelay(
  data: { cands: PathCandidate[]; ticks: Map<string, Tick[]> },
  delays: number[],
  exit: ExitConfig,
  replay: ReplayOptions,
  folds = 4,
  minN = 15,
) {
  const sorted = [...data.cands].sort((a, b) => a.t0 - b.t0);
  const size = Math.max(1, Math.floor(sorted.length / (folds + 1)));
  const perDelay = new Map(
    delays.map((d) => [d, delayRows({ cands: sorted, ticks: data.ticks }, d, exit, replay)]),
  );
  const oos: DatasetRow[] = [];
  const zero: DatasetRow[] = [];
  const out: {
    fold: number;
    chosen: number;
    trainMean: number | null;
    test: GroupStats;
    testDelay0: GroupStats;
  }[] = [];
  for (let i = 1; i <= folds; i++) {
    const trainIdx = [0, i * size] as const;
    const testIdx = [i * size, i === folds ? sorted.length : (i + 1) * size] as const;
    let best = delays[0]!;
    let bestMean = Number.NEGATIVE_INFINITY;
    for (const d of delays) {
      const st = groupStats(perDelay.get(d)!.slice(...trainIdx));
      if (st.n >= minN && (st.meanPnl ?? -1e9) > bestMean) {
        bestMean = st.meanPnl!;
        best = d;
      }
    }
    const test = perDelay.get(best)!.slice(...testIdx);
    const test0 = perDelay.get(delays[0]!)!.slice(...testIdx);
    oos.push(...test);
    zero.push(...test0);
    out.push({
      fold: i,
      chosen: best,
      trainMean: Number.isFinite(bestMean) ? bestMean : null,
      test: groupStats(test),
      testDelay0: groupStats(test0),
    });
  }
  return { folds: out, oos: groupStats(oos), oosDelay0: groupStats(zero) };
}

export interface CostModel {
  /** median biaya round-trip (%) per bucket likuiditas, dari cost probe */
  buckets: { lo: number; hi: number; medianPct: number; n: number }[];
  overallPct: number;
  fallbackPct: number;
  source: "terukur" | "asumsi";
}

export const LIQ_EDGES = [0, 10_000, 30_000, 50_000, 100_000, Number.POSITIVE_INFINITY];

/** Model biaya dari cost probe (bucket dengan < minN probe memakai median keseluruhan / fallback). */
export async function loadCostModel(db: Db, hours: number, fallbackPct = 4, minN = 5): Promise<CostModel> {
  const rows = (await db`
    SELECT liquidity_usd::float AS liq, total_cost_pct AS cost FROM cost_probes
    WHERE error IS NULL AND liquidity_usd IS NOT NULL AND total_cost_pct IS NOT NULL
      AND ts > now() - make_interval(hours => ${hours})`) as { liq: number; cost: number }[];
  const med = (xs: number[]) => {
    const a = [...xs].sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
  };
  const overall = rows.length >= minN ? med(rows.map((r) => r.cost)) : fallbackPct;
  const buckets = LIQ_EDGES.slice(0, -1).map((lo, i) => {
    const hi = LIQ_EDGES[i + 1]!;
    const xs = rows.filter((r) => r.liq >= lo && r.liq < hi).map((r) => r.cost);
    return {
      lo,
      hi,
      n: xs.length,
      medianPct: xs.length >= minN ? Math.round(med(xs) * 100) / 100 : Number.NaN,
    };
  });
  return {
    buckets,
    overallPct: Math.round(overall * 100) / 100,
    fallbackPct,
    source: rows.length >= minN ? "terukur" : "asumsi",
  };
}

/** Biaya round-trip (%) untuk likuiditas tertentu: bucket terukur → median keseluruhan → fallback. */
export function costForLiquidity(model: CostModel, liq: number | null): number {
  if (liq === null || !Number.isFinite(liq)) return model.overallPct;
  const b = model.buckets.find((x) => liq >= x.lo && liq < x.hi);
  if (b && Number.isFinite(b.medianPct)) return b.medianPct;
  // bucket likuid belum ada data → pakai bucket terukur terdekat di bawahnya (konservatif: biaya lebih tinggi)
  const below = model.buckets.filter((x) => x.hi <= liq && Number.isFinite(x.medianPct)).pop();
  return below?.medianPct ?? model.overallPct;
}

export type Verdict = "ada_edge" | "tidak_ada_edge" | "data_kurang";

/** Kesimpulan otomatis: edge hanya kalau out-of-sample walk-forward positif dengan sampel cukup. */
export function verdict(oos: GroupStats, minTrades = 30): { verdict: Verdict; reason: string } {
  if (oos.n < minTrades)
    return { verdict: "data_kurang", reason: `baru ${oos.n} trade out-of-sample (< ${minTrades})` };
  if ((oos.meanPnl ?? 0) > 0 && (oos.medianPnl ?? -1) > -2)
    return {
      verdict: "ada_edge",
      reason: `OOS mean ${oos.meanPnl}% & median ${oos.medianPnl}% dari ${oos.n} trade`,
    };
  return {
    verdict: "tidak_ada_edge",
    reason: `OOS mean ${oos.meanPnl}% / median ${oos.medianPnl}% dari ${oos.n} trade`,
  };
}
