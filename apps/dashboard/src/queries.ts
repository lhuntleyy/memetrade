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

// ---------------- Fase 2: pipeline & token explorer ----------------

/** Funnel per profile: tiap (mint, trigger) yang dievaluasi → lolos security → lolos filter → sinyal. */
export function pipelineFunnel(db: Db, hours: number) {
  return db`
    WITH per AS (
      SELECT profile, mint, trigger_ts,
             bool_and(passed) FILTER (WHERE stage = 'security') AS sec_ok,
             bool_and(passed) FILTER (WHERE stage = 'filter')   AS filter_ok
      FROM decisions
      WHERE ts > now() - make_interval(hours => ${hours})
      GROUP BY 1, 2, 3
    )
    SELECT profile,
           count(*)::int AS evaluated,
           count(*) FILTER (WHERE sec_ok)::int AS security_pass,
           count(*) FILTER (WHERE filter_ok)::int AS filter_pass,
           count(*) FILTER (WHERE sec_ok AND filter_ok)::int AS signals
    FROM per GROUP BY profile ORDER BY profile`;
}

export function rejectReasons(db: Db, hours: number) {
  return db`
    SELECT profile, stage, reason, count(*)::int AS n
    FROM decisions, unnest(failed_rules) AS reason
    WHERE ts > now() - make_interval(hours => ${hours}) AND NOT passed
    GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT 40`;
}

/**
 * Efektivitas filter (shadow): untuk tiap rule, token yang ditolak rule itu — berapa % yang ternyata
 * pump ≥+50% (winner terbuang) vs rug (selamat). Dibandingkan dengan token yang lolos filter.
 */
export function filterEffectiveness(db: Db, hours: number) {
  return db`
    WITH f AS (
      SELECT d.profile, d.passed, d.failed_rules, p.max_ret, p.rugged
      FROM decisions d
      JOIN tracked_paths p ON p.mint = d.mint AND p.source = d.trigger_source AND p.t0 = d.trigger_ts
      WHERE d.stage = 'filter' AND d.ts > now() - make_interval(hours => ${hours})
        AND p.completed_at IS NOT NULL AND p.max_ret IS NOT NULL
    ), rows AS (
      SELECT profile, unnest(failed_rules) AS rule, max_ret, rugged FROM f WHERE NOT passed
      UNION ALL
      SELECT profile, '(lolos filter)', max_ret, rugged FROM f WHERE passed
      UNION ALL
      SELECT profile, '(semua token)', max_ret, rugged FROM f
    )
    SELECT profile, rule, count(*)::int AS n,
           round(100.0 * avg((max_ret >= 50)::int), 1) AS hit50,
           round(100.0 * avg((max_ret >= 100)::int), 1) AS hit100,
           round(100.0 * avg(rugged::int), 1) AS rug_rate,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY max_ret)::numeric, 1) AS med_max_ret
    FROM rows GROUP BY 1, 2 ORDER BY 1, (rule LIKE '(%') DESC, n DESC`;
}

export async function tokenDetail(db: Db, mint: string) {
  const [[token], triggers, decisions, [security], paths, ticks] = await Promise.all([
    db`SELECT * FROM tokens WHERE mint = ${mint}`,
    db`SELECT ts, source, kind FROM token_triggers WHERE mint = ${mint} ORDER BY ts DESC LIMIT 20`,
    db`SELECT ts, profile, stage, passed, failed_rules, features, trigger_source
       FROM decisions WHERE mint = ${mint} ORDER BY ts DESC LIMIT 30`,
    db`SELECT * FROM security_reports WHERE mint = ${mint} ORDER BY ts DESC LIMIT 1`,
    db`SELECT * FROM tracked_paths WHERE mint = ${mint} ORDER BY t0 DESC`,
    db`SELECT ts, price_sol, price_usd, mcap_usd FROM ticks WHERE mint = ${mint}
       AND ts > now() - interval '3 hours' ORDER BY ts`,
  ]);
  return { token: token ?? null, triggers, decisions, security: security ?? null, paths, ticks };
}

// ---------------- Fase 3: trading (paper) ----------------

export function closedPositions(db: Db, limit: number) {
  return db`
    SELECT id, mint, symbol, profile, mode, opened_at, closed_at, size_sol, cost_sol, proceeds_sol, fees_sol,
           realized_pnl_sol, pnl_pct, mfe_pct, mae_pct, exit_reason, status
    FROM positions WHERE status IN ('CLOSED', 'ENTRY_FAILED')
    ORDER BY COALESCE(closed_at, opened_at) DESC NULLS LAST LIMIT ${limit}`;
}

export function tradingKpi(db: Db, mode: string) {
  return db`
    WITH c AS (SELECT * FROM positions WHERE status = 'CLOSED' AND mode = ${mode})
    SELECT
      count(*)::int AS trades,
      count(*) FILTER (WHERE realized_pnl_sol > 0)::int AS wins,
      round(100.0 * avg((realized_pnl_sol > 0)::int), 1) AS win_rate,
      round(COALESCE(sum(realized_pnl_sol), 0)::numeric, 4) AS pnl_sol,
      round(COALESCE(sum(fees_sol), 0)::numeric, 4) AS fees_sol,
      round(avg(pnl_pct) FILTER (WHERE realized_pnl_sol > 0)::numeric, 1) AS avg_win_pct,
      round(avg(pnl_pct) FILTER (WHERE realized_pnl_sol <= 0)::numeric, 1) AS avg_loss_pct,
      round((sum(realized_pnl_sol) FILTER (WHERE realized_pnl_sol > 0) /
             NULLIF(abs(sum(realized_pnl_sol) FILTER (WHERE realized_pnl_sol <= 0)), 0))::numeric, 2) AS profit_factor,
      round(avg(realized_pnl_sol)::numeric, 5) AS expectancy_sol,
      round(COALESCE(sum(realized_pnl_sol) FILTER (WHERE closed_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)::numeric, 4) AS pnl_today_sol,
      (SELECT count(*) FROM positions WHERE status = 'ENTRY_FAILED' AND mode = ${mode})::int AS entry_failed
    FROM c`;
}

export function exitReasons(db: Db, mode: string) {
  return db`
    SELECT exit_reason, count(*)::int AS n, round(avg(pnl_pct)::numeric, 1) AS avg_pnl_pct
    FROM positions WHERE status = 'CLOSED' AND mode = ${mode}
    GROUP BY 1 ORDER BY n DESC`;
}

export function equityCurve(db: Db, mode: string) {
  return db`
    SELECT closed_at, sum(realized_pnl_sol) OVER (ORDER BY closed_at)::float AS equity
    FROM positions WHERE status = 'CLOSED' AND mode = ${mode} ORDER BY closed_at`;
}

// ---------------- wallet tracker ----------------

/** Papan wallet: wallet yang paling sering muncul sebagai top holder / pembeli besar. */
export function walletLeaderboard(db: Db, hours: number, minTier: number, kind: string, limit: number) {
  // tag & data watchlist diambil SETELAH LIMIT (bukan sub-query per wallet untuk semua ±19 ribu wallet)
  return db`
    WITH o AS (
      SELECT * FROM wallet_observations
      WHERE ts > now() - make_interval(hours => ${hours})
        AND (${kind} = 'all' OR kind = ${kind})
        AND (kind <> 'big_buyer' OR COALESCE(buy_tier_usd, 0) >= ${minTier})
    ), per_token AS (
      SELECT wallet, mint,
             bool_or(kind = 'top_holder') AS top, bool_or(kind = 'big_buyer') AS big,
             max(buy_volume_usd) AS buy_usd, max(profit_usd) AS profit_usd, max(ts) AS ts,
             bool_or(maker_tags && ARRAY['creator', 'dev_team']) AS dev
      FROM o GROUP BY wallet, mint
    ), board AS (
      SELECT p.wallet,
             count(*)::int AS tokens,
             count(*) FILTER (WHERE p.top)::int AS as_top_holder,
             count(*) FILTER (WHERE p.big)::int AS as_big_buyer,
             round(COALESCE(sum(p.buy_usd), 0)::numeric, 0) AS buy_usd,
             round(COALESCE(sum(p.profit_usd), 0)::numeric, 0) AS profit_usd,
             max(p.ts) AS last_seen,
             bool_or(p.dev) AS is_dev
      FROM per_token p GROUP BY p.wallet
    ), top AS (
      SELECT b.*, ww.score_value AS score, ww.score AS score_parts,
             COALESCE(ww.active, false) AS watched, COALESCE(ww.auto, false) AS auto
      FROM board b LEFT JOIN watch_wallets ww ON ww.address = b.wallet
      ORDER BY ww.score_value DESC NULLS LAST, b.tokens DESC, b.buy_usd DESC
      LIMIT ${limit}
    )
    SELECT top.*,
           (SELECT array_agg(DISTINCT t) FROM wallet_observations w2, unnest(w2.tags) t WHERE w2.wallet = top.wallet) AS tags
    FROM top
    ORDER BY score DESC NULLS LAST, tokens DESC, buy_usd DESC`;
}

export function walletDetail(db: Db, address: string) {
  return db`
    SELECT o.mint, COALESCE(o.symbol, k.symbol) AS symbol, o.kind, o.rank, o.buy_tier_usd, o.usd_value, o.amount_pct,
           o.buy_volume_usd, o.sell_volume_usd, o.profit_usd, o.tags, o.maker_tags, o.ts,
           p.max_ret, p.rugged
    FROM wallet_observations o
    LEFT JOIN tokens k ON k.mint = o.mint
    LEFT JOIN LATERAL (SELECT max_ret, rugged FROM tracked_paths tp WHERE tp.mint = o.mint ORDER BY t0 LIMIT 1) p ON true
    WHERE o.wallet = ${address} ORDER BY o.ts DESC LIMIT 200`;
}

/** Sinyal konfluensi smart money + apakah lanjut jadi entry paper. */
export function smartSignals(db: Db, hours: number) {
  return db`
    SELECT s.id, s.ts, s.mint, COALESCE(s.symbol, k.symbol) AS symbol, s.source, s.n_wallets, s.avg_score, s.wallets,
           (SELECT d.passed FROM decisions d WHERE d.mint = s.mint AND d.profile = 'smart_money' AND d.stage = 'filter'
              AND d.ts >= s.ts ORDER BY d.ts LIMIT 1) AS filter_passed,
           (SELECT p.status || COALESCE(':' || round(p.pnl_pct::numeric, 1), '') FROM positions p
              WHERE p.mint = s.mint AND p.profile = 'smart_money' AND p.opened_at >= s.ts - interval '1 minute'
              ORDER BY p.id LIMIT 1) AS position
    FROM smart_signals s LEFT JOIN tokens k ON k.mint = s.mint
    WHERE s.ts > now() - make_interval(hours => ${hours})
    ORDER BY s.ts DESC LIMIT 100`;
}

/** Ringkasan watchlist: jumlah wallet otomatis/manual & sebaran skor. */
export function watchSummary(db: Db) {
  return db`
    SELECT count(*) FILTER (WHERE active AND auto)::int AS auto_active,
           count(*) FILTER (WHERE active AND NOT auto)::int AS manual_active,
           count(*) FILTER (WHERE score_value IS NOT NULL)::int AS scored,
           count(*) FILTER (WHERE score_value >= 60)::int AS score_60,
           round(max(score_value)::numeric, 1) AS max_score
    FROM watch_wallets`;
}

/** Biaya eksekusi terukur (cost probe) per bucket likuiditas. */
export function costByLiquidity(db: Db, hours: number) {
  return db`
    SELECT CASE WHEN liquidity_usd < 10000 THEN '< $10rb'
                WHEN liquidity_usd < 30000 THEN '$10–30rb'
                WHEN liquidity_usd < 50000 THEN '$30–50rb'
                WHEN liquidity_usd < 100000 THEN '$50–100rb'
                ELSE '≥ $100rb' END AS bucket,
           min(liquidity_usd) AS lo,
           count(*)::int AS n,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_cost_pct)::numeric, 2) AS med_total,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY total_cost_pct)::numeric, 2) AS p75_total,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY quote_cost_pct)::numeric, 2) AS med_quote,
           round(avg(network_cost_pct)::numeric, 2) AS network
    FROM cost_probes
    WHERE ts > now() - make_interval(hours => ${hours}) AND error IS NULL AND liquidity_usd IS NOT NULL
    GROUP BY 1 ORDER BY lo`;
}

export function costProbeCounts(db: Db, hours: number) {
  return db`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE error IS NOT NULL)::int AS failed,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_cost_pct)::numeric, 2) AS med_total
    FROM cost_probes WHERE ts > now() - make_interval(hours => ${hours})`;
}
