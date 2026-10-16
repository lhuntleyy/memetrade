import type { Db } from "@memebot/db";

/** Query analitik dashboard (role read-only). Jam dalam WIB untuk tampilan. */

export function recentTriggers(db: Db, limit: number) {
  return db`
    SELECT t.ts, t.mint, t.source, t.kind,
           COALESCE((t.payload->>'backlog')::boolean, false) AS backlog,
           k.symbol, k.name,
           p.entry_price_ref, p.max_ret, p.min_ret, p.ret_5m, p.rugged, p.n_ticks, p.completed_at
    FROM token_triggers t
    LEFT JOIN tokens k ON k.mint = t.mint
    LEFT JOIN tracked_paths p ON p.mint = t.mint AND p.source = t.source || '.' || t.kind AND p.t0 = t.ts
    ORDER BY t.ts DESC
    LIMIT ${limit}`;
}

/** Ringkasan per sumber dari path yang sudah selesai dan punya data harga. */
export function labSources(db: Db, hours: number) {
  return db`
    WITH p AS (
      SELECT * FROM tracked_paths WHERE t0 > now() - make_interval(hours => ${hours})
    )
    SELECT source,
      count(*)::int                                                     AS n_total,
      count(*) FILTER (WHERE completed_at IS NULL)::int                 AS n_running,
      count(*) FILTER (WHERE completed_at IS NOT NULL AND entry_price_ref IS NOT NULL)::int AS n_done,
      count(*) FILTER (WHERE completed_at IS NOT NULL AND entry_price_ref IS NULL)::int     AS n_no_price,
      round(100.0 * avg((max_ret >= 20)::int)  FILTER (WHERE completed_at IS NOT NULL AND max_ret IS NOT NULL), 1) AS hit20,
      round(100.0 * avg((max_ret >= 50)::int)  FILTER (WHERE completed_at IS NOT NULL AND max_ret IS NOT NULL), 1) AS hit50,
      round(100.0 * avg((max_ret >= 100)::int) FILTER (WHERE completed_at IS NOT NULL AND max_ret IS NOT NULL), 1) AS hit100,
      round(100.0 * avg(rugged::int) FILTER (WHERE completed_at IS NOT NULL AND rugged IS NOT NULL), 1)            AS rug_rate,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY max_ret) FILTER (WHERE completed_at IS NOT NULL)::numeric, 1) AS med_max_ret,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY t_max_sec) FILTER (WHERE completed_at IS NOT NULL AND max_ret >= 20)::numeric / 60, 1) AS med_min_to_peak,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ret_5m)  FILTER (WHERE completed_at IS NOT NULL)::numeric, 1) AS med_ret_5m,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ret_15m) FILTER (WHERE completed_at IS NOT NULL)::numeric, 1) AS med_ret_15m,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ret_60m) FILTER (WHERE completed_at IS NOT NULL)::numeric, 1) AS med_ret_60m,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ref_delay_sec)::numeric, 0) AS med_ref_delay_sec
    FROM p GROUP BY source ORDER BY n_total DESC`;
}

/** Hit-rate +50% per sumber × jam WIB (0–23). */
export function labHeatmap(db: Db, hours: number) {
  return db`
    SELECT source,
           extract(hour FROM t0 AT TIME ZONE 'Asia/Jakarta')::int AS hour_wib,
           count(*)::int AS n,
           round(100.0 * avg((max_ret >= 50)::int), 1) AS hit50,
           round(100.0 * avg(rugged::int), 1) AS rug_rate
    FROM tracked_paths
    WHERE t0 > now() - make_interval(hours => ${hours})
      AND completed_at IS NOT NULL AND max_ret IS NOT NULL
    GROUP BY 1, 2 ORDER BY 1, 2`;
}

/** Distribusi max return per sumber (bucket tetap). */
export function labDistribution(db: Db, hours: number) {
  return db`
    SELECT source,
           CASE WHEN max_ret < 0 THEN '<0' WHEN max_ret < 20 THEN '0–20' WHEN max_ret < 50 THEN '20–50'
                WHEN max_ret < 100 THEN '50–100' WHEN max_ret < 300 THEN '100–300' ELSE '≥300' END AS bucket,
           count(*)::int AS n
    FROM tracked_paths
    WHERE t0 > now() - make_interval(hours => ${hours}) AND completed_at IS NOT NULL AND max_ret IS NOT NULL
    GROUP BY 1, 2`;
}

export function counts(db: Db) {
  return db`
    SELECT
      (SELECT count(*) FROM tokens)::int AS tokens,
      (SELECT count(*) FROM token_triggers WHERE ts > now() - interval '24 hours')::int AS triggers_24h,
      (SELECT count(*) FROM tracked_paths WHERE completed_at IS NOT NULL)::int AS paths_done,
      (SELECT count(*) FROM ticks WHERE ts > now() - interval '1 hour')::int AS ticks_1h`;
}
