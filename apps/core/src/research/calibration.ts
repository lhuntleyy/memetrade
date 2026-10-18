import type { Db } from "@memebot/db";
import type { ExitConfig } from "@memebot/shared";
import { despike } from "../market/despike.ts";
import { type CostModel, costForLiquidity } from "./features.ts";
import { type ReplayOptions, simulate, type Tick } from "./replay.ts";

/**
 * Kalibrasi backtest terhadap paper trading: setiap posisi paper yang tutup di-replay di titik entry yang sama
 * (exit engine & config yang sama), lalu selisihnya dipecah per alasan exit. Hasilnya `exitGapPct` (tambahan rugi
 * per alasan exit) yang dipakai replay/analyze supaya tidak terlalu optimis.
 */

export interface PaperTrade {
  id: number;
  mint: string;
  profile: string;
  entryRequestedAt: number;
  paperPnlPct: number;
  paperReason: string;
  liquidityUsd: number | null;
  entrySlipPct: number | null;
}

export interface TradeComparison extends PaperTrade {
  replayPnlPct: number | null;
  replayReason: string | null;
}

/** @param since hanya posisi yang dibuka setelah waktu ini (mis. sejak exit berbasis quote aktif) */
export async function loadPaperTrades(db: Db, hours: number, since?: Date): Promise<PaperTrade[]> {
  const rows = (await db`
    SELECT p.id, p.mint, p.profile, p.pnl_pct, p.exit_reason,
           (SELECT min(o.requested_at) FROM orders o WHERE o.position_id = p.id AND o.side = 'buy') AS req_at,
           (SELECT (d.features->>'liquidity_usd')::float FROM decisions d
              WHERE d.mint = p.mint AND d.profile = p.profile AND d.stage = 'filter' AND d.ts <= p.opened_at
              ORDER BY d.ts DESC LIMIT 1) AS liq,
           (SELECT (fl.exec_price / t.price_sol - 1) * 100
              FROM orders o JOIN fills fl ON fl.order_id = o.id
              JOIN LATERAL (SELECT price_sol FROM ticks t WHERE t.mint = p.mint AND t.ts BETWEEN fl.ts - interval '15 seconds' AND fl.ts
                            ORDER BY t.ts DESC LIMIT 1) t ON true
              WHERE o.position_id = p.id AND o.side = 'buy' LIMIT 1) AS entry_slip
    FROM positions p
    WHERE p.status = 'CLOSED' AND p.mode = 'paper' AND p.opened_at > now() - make_interval(hours => ${hours})
      AND p.opened_at > ${since ?? new Date(0)}
    ORDER BY p.opened_at`) as {
    id: string;
    mint: string;
    profile: string;
    pnl_pct: number;
    exit_reason: string;
    req_at: Date | null;
    liq: number | null;
    entry_slip: number | null;
  }[];
  return rows
    .filter((r) => r.req_at)
    .map((r) => ({
      id: Number(r.id),
      mint: r.mint,
      profile: r.profile,
      entryRequestedAt: new Date(r.req_at!).getTime(),
      paperPnlPct: Number(r.pnl_pct),
      paperReason: r.exit_reason,
      liquidityUsd: r.liq === null ? null : Number(r.liq),
      entrySlipPct: r.entry_slip === null ? null : Number(r.entry_slip),
    }));
}

export async function loadTicksFor(db: Db, mints: string[], hours: number): Promise<Map<string, Tick[]>> {
  const ticks = new Map<string, Tick[]>();
  for (let i = 0; i < mints.length; i += 400) {
    const chunk = mints.slice(i, i + 400);
    const tr = (await db`
      SELECT mint, ts, price_sol FROM ticks
      WHERE mint IN ${db(chunk)} AND ts > now() - make_interval(hours => ${hours + 2}) AND price_sol > 0
      ORDER BY mint, ts`) as { mint: string; ts: Date; price_sol: number }[];
    for (const t of tr) {
      const list = ticks.get(t.mint) ?? [];
      list.push({ ts: new Date(t.ts).getTime(), price: Number(t.price_sol) });
      ticks.set(t.mint, list);
    }
  }
  for (const [m, list] of ticks) ticks.set(m, despike(list, m));
  return ticks;
}

export function compareTrades(
  trades: PaperTrade[],
  ticks: Map<string, Tick[]>,
  exitFor: (profile: string) => ExitConfig | undefined,
  costs: CostModel,
  base: Omit<ReplayOptions, "entryCostPct" | "exitCostPct">,
): TradeComparison[] {
  return trades.map((t) => {
    const exit = exitFor(t.profile);
    const cost = costForLiquidity(costs, t.liquidityUsd);
    const r = exit
      ? simulate(
          { mint: t.mint, profile: t.profile, ts: t.entryRequestedAt },
          ticks.get(t.mint) ?? [],
          exit,
          {
            ...base,
            entryCostPct: cost / 2,
            exitCostPct: cost / 2,
          },
        )
      : null;
    return { ...t, replayPnlPct: r?.pnlPct ?? null, replayReason: r?.reason ?? null };
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

export interface GapSummary {
  n: number;
  paperMean: number | null;
  replayMean: number | null;
  gap: number | null;
  sameReasonPct: number | null;
  byPaperReason: Record<
    string,
    { n: number; paperMean: number | null; replayMean: number | null; gap: number | null }
  >;
}

export function summarizeGap(c: TradeComparison[]): GapSummary {
  const ok = c.filter((x) => x.replayPnlPct !== null);
  const by: GapSummary["byPaperReason"] = {};
  for (const reason of [...new Set(ok.map((x) => x.paperReason))]) {
    const g = ok.filter((x) => x.paperReason === reason);
    const pm = mean(g.map((x) => x.paperPnlPct));
    const rm = mean(g.map((x) => x.replayPnlPct!));
    by[reason] = {
      n: g.length,
      paperMean: r2(pm),
      replayMean: r2(rm),
      gap: r2(pm !== null && rm !== null ? pm - rm : null),
    };
  }
  const pm = mean(ok.map((x) => x.paperPnlPct));
  const rm = mean(ok.map((x) => x.replayPnlPct!));
  return {
    n: ok.length,
    paperMean: r2(pm),
    replayMean: r2(rm),
    gap: r2(pm !== null && rm !== null ? pm - rm : null),
    sameReasonPct: ok.length
      ? r2((ok.filter((x) => x.paperReason === x.replayReason).length / ok.length) * 100)
      : null,
    byPaperReason: by,
  };
}

/**
 * Gap per alasan exit VERSI REPLAY (poin %): rata-rata (replay − paper) untuk trade dengan alasan replay itu.
 * Dikelompokkan menurut alasan replay karena itulah yang diketahui saat backtest (mis. replay "data_end" sering
 * berarti rug yang tak terlihat di data DexScreener). Hanya gap positif (replay lebih optimis) dengan ≥ minN sampel.
 */
export function fitExitGaps(c: TradeComparison[], minN = 8): Record<string, number> {
  const gaps: Record<string, number> = {};
  const ok = c.filter((x) => x.replayPnlPct !== null && x.replayReason !== null);
  for (const reason of [...new Set(ok.map((x) => x.replayReason!))]) {
    const g = ok.filter((x) => x.replayReason === reason);
    if (g.length < minN) continue;
    const gap = mean(g.map((x) => x.replayPnlPct! - x.paperPnlPct))!;
    if (gap > 0) gaps[reason] = Math.round(gap * 10) / 10;
  }
  return gaps;
}

export function summarizeByReplayReason(c: TradeComparison[]) {
  const ok = c.filter((x) => x.replayPnlPct !== null && x.replayReason !== null);
  const out: Record<
    string,
    { n: number; paperMean: number | null; replayMean: number | null; gap: number | null }
  > = {};
  for (const reason of [...new Set(ok.map((x) => x.replayReason!))]) {
    const g = ok.filter((x) => x.replayReason === reason);
    const pm = mean(g.map((x) => x.paperPnlPct));
    const rm = mean(g.map((x) => x.replayPnlPct!));
    out[reason] = {
      n: g.length,
      paperMean: r2(pm),
      replayMean: r2(rm),
      gap: r2(pm !== null && rm !== null ? rm - pm : null),
    };
  }
  return out;
}

export interface CalibrationParams {
  method?: "flat" | "gap" | "none" | "source";
  flatHaircutPct?: number;
  /** potongan (poin %/trade) per kelompok sumber: migration, dexscreener, new_token, wallet */
  sourceHaircutPct?: Record<string, number>;
  exitGapPct: Record<string, number>;
  capProfitAtTp: boolean;
  entrySlipPct: number | null;
}

export async function latestCalibration(db: Db): Promise<CalibrationParams | null> {
  const [row] = await db`SELECT params FROM replay_calibration ORDER BY id DESC LIMIT 1`;
  return (row?.params as CalibrationParams | undefined) ?? null;
}

/** Kelompok sumber untuk kalibrasi (dari trigger source atau nama profile). */
export function sourceGroup(sourceOrProfile: string): string {
  const x = sourceOrProfile;
  if (x.includes("migration")) return "migration";
  if (x.startsWith("dexscreener") || x.includes("trending")) return "dexscreener";
  if (x.includes("new_token")) return "new_token";
  if (x.startsWith("wallet") || x.includes("smart_money")) return "wallet";
  return "other";
}

/**
 * Potongan per kelompok sumber = max(0, replay − paper) × n / (n + shrinkN). Hanya mengoreksi replay yang terlalu
 * optimis; kelompok yang replay-nya sudah pesimis tidak "dipercantik". Shrinkage menahan sampel kecil.
 */
export function fitSourceHaircuts(c: TradeComparison[], shrinkN = 20): Record<string, number> {
  const out: Record<string, number> = {};
  const ok = c.filter((x) => x.replayPnlPct !== null);
  for (const g of [...new Set(ok.map((x) => sourceGroup(x.profile)))]) {
    const sub = ok.filter((x) => sourceGroup(x.profile) === g);
    const gap = mean(sub.map((x) => x.replayPnlPct! - x.paperPnlPct))!;
    out[g] = Math.round(Math.max(0, gap) * (sub.length / (sub.length + shrinkN)) * 10) / 10;
  }
  return out;
}

/** Opsi replay dari kalibrasi untuk sebuah sumber/profile. */
export function calibrationOptions(cal: CalibrationParams | null, sourceOrProfile: string) {
  if (!cal) return {};
  return {
    capProfitAtTp: cal.capProfitAtTp,
    flatHaircutPct:
      cal.method === "source"
        ? (cal.sourceHaircutPct?.[sourceGroup(sourceOrProfile)] ?? 0)
        : (cal.flatHaircutPct ?? 0),
    exitGapPct: cal.method === "gap" ? cal.exitGapPct : undefined,
  };
}
