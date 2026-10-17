import type { Db } from "@memebot/db";
import type { Logger, SourcesConfig } from "@memebot/shared";

/**
 * Skor wallet (0–100) dari data wallet tracker — deterministik, tanpa LLM.
 * Komponen (bobot): win share token (35), token yang pump ≥ +50% (25), bebas rug (20), total profit (10),
 * lalu bonus/penalti tag GMGN. Wallet creator/dev team token dikeluarkan (skor 0).
 */

export interface WalletAggregate {
  wallet: string;
  /** jumlah token berbeda tempat wallet terlihat (top holder / pembeli besar) */
  tokens: number;
  /** token dengan profit_usd > 0 (GMGN, realized + unrealized) */
  profitable: number;
  totalProfitUsd: number;
  /** token yang punya hasil tracked_paths selesai */
  withOutcome: number;
  pumped: number;
  rugged: number;
  tags: string[];
  isDev: boolean;
}

export interface WalletScore {
  wallet: string;
  score: number | null;
  reason: string;
  parts: Record<string, number>;
}

export function scoreWallet(a: WalletAggregate, minTokens: number): WalletScore {
  if (a.isDev) return { wallet: a.wallet, score: 0, reason: "dev_or_creator", parts: {} };
  if (a.tokens < minTokens)
    return { wallet: a.wallet, score: null, reason: `sampel_kurang(${a.tokens}<${minTokens})`, parts: {} };
  const win = a.profitable / a.tokens;
  const pump = a.withOutcome ? a.pumped / a.withOutcome : 0;
  const noRug = a.withOutcome ? 1 - a.rugged / a.withOutcome : 0.5;
  const profit = Math.min(1, Math.max(0, Math.log10(Math.max(1, a.totalProfitUsd)) / 4)); // $10k → penuh
  const tags = new Set(a.tags);
  const tagAdj =
    (tags.has("smart_degen") ? 10 : 0) +
    (tags.has("renowned") ? 5 : 0) -
    (tags.has("bundler") ? 15 : 0) -
    (tags.has("rat_trader") ? 15 : 0) -
    (tags.has("sniper") ? 5 : 0);
  const parts = {
    win: Math.round(win * 35 * 10) / 10,
    pump: Math.round(pump * 25 * 10) / 10,
    noRug: Math.round(noRug * 20 * 10) / 10,
    profit: Math.round(profit * 10 * 10) / 10,
    tags: tagAdj,
  };
  const score = Math.max(0, Math.min(100, parts.win + parts.pump + parts.noRug + parts.profit + parts.tags));
  return { wallet: a.wallet, score: Math.round(score * 10) / 10, reason: "ok", parts };
}

/** Agregasi per wallet dari DB (lookback hari). */
export async function loadWalletAggregates(db: Db, lookbackDays: number): Promise<WalletAggregate[]> {
  const rows = (await db`
    WITH per_token AS (
      SELECT o.wallet, o.mint,
             max(o.profit_usd) AS profit_usd,
             bool_or(o.maker_tags && ARRAY['creator', 'dev_team']) AS dev,
             array_agg(DISTINCT t) FILTER (WHERE t IS NOT NULL) AS tags
      FROM wallet_observations o
      LEFT JOIN LATERAL unnest(o.tags) t ON true
      WHERE o.ts > now() - make_interval(days => ${lookbackDays})
      GROUP BY o.wallet, o.mint
    ), outcome AS (
      SELECT DISTINCT ON (mint) mint, max_ret, rugged
      FROM tracked_paths WHERE completed_at IS NOT NULL AND max_ret IS NOT NULL
      ORDER BY mint, t0
    )
    SELECT p.wallet,
           count(*)::int AS tokens,
           count(*) FILTER (WHERE p.profit_usd > 0)::int AS profitable,
           COALESCE(sum(p.profit_usd), 0)::float AS total_profit,
           count(o.mint)::int AS with_outcome,
           count(*) FILTER (WHERE o.max_ret >= 50)::int AS pumped,
           count(*) FILTER (WHERE o.rugged)::int AS rugged,
           bool_or(p.dev) AS is_dev,
           (SELECT array_agg(DISTINCT x) FROM per_token p2, unnest(p2.tags) x WHERE p2.wallet = p.wallet) AS tags
    FROM per_token p LEFT JOIN outcome o ON o.mint = p.mint
    GROUP BY p.wallet`) as {
    wallet: string;
    tokens: number;
    profitable: number;
    total_profit: number;
    with_outcome: number;
    pumped: number;
    rugged: number;
    is_dev: boolean | null;
    tags: string[] | null;
  }[];
  return rows.map((r) => ({
    wallet: r.wallet,
    tokens: r.tokens,
    profitable: r.profitable,
    totalProfitUsd: Number(r.total_profit),
    withOutcome: r.with_outcome,
    pumped: r.pumped,
    rugged: r.rugged,
    tags: r.tags ?? [],
    isDev: Boolean(r.is_dev),
  }));
}

/**
 * Hitung skor semua wallet, simpan ke watch_wallets.
 *  - wallet otomatis (auto) diaktifkan kalau skor ≥ min_score dan termasuk top N; dinonaktifkan kalau turun.
 *  - wallet yang dipantau manual dari dashboard tidak pernah dinonaktifkan otomatis.
 */
export async function refreshWalletScores(
  db: Db,
  cfg: SourcesConfig["wallet_tracker"]["scoring"],
  log: Logger,
): Promise<{ scored: number; active: number }> {
  const aggs = await loadWalletAggregates(db, cfg.lookback_days);
  const scores = aggs.map((a) => scoreWallet(a, cfg.min_tokens));
  const good = scores
    .filter((s) => s.score !== null && s.score >= cfg.min_score)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, cfg.auto_watch_top);
  const goodSet = new Set(good.map((g) => g.wallet));
  const rows = scores
    .filter((s) => s.score !== null)
    .map((s) => ({
      address: s.wallet,
      score_value: s.score,
      score: { ...s.parts, reason: s.reason },
      auto_active: goodSet.has(s.wallet),
    }));
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db`
      INSERT INTO watch_wallets (address, label, source, active, score, score_value, auto, updated_at)
      SELECT x.address, NULL, 'auto', x.auto_active, x.score, x.score_value, true, now()
      FROM jsonb_to_recordset(${chunk}::jsonb) AS x(address text, score_value numeric, score jsonb, auto_active boolean)
      ON CONFLICT (address) DO UPDATE SET
        score = EXCLUDED.score, score_value = EXCLUDED.score_value, updated_at = now(),
        active = CASE WHEN watch_wallets.auto THEN EXCLUDED.active ELSE watch_wallets.active END`;
  }
  log.info({ wallets: aggs.length, scored: rows.length, autoActive: good.length }, "skor wallet diperbarui");
  return { scored: rows.length, active: good.length };
}

/** Wallet "bagus" saat ini: aktif (otomatis dengan skor ≥ min, atau manual). Map wallet → skor (manual = null). */
export async function loadGoodWallets(db: Db, minScore: number): Promise<Map<string, number | null>> {
  const rows = (await db`
    SELECT address, score_value FROM watch_wallets
    WHERE active AND (NOT auto OR score_value >= ${minScore})`) as {
    address: string;
    score_value: number | null;
  }[];
  return new Map(rows.map((r) => [r.address, r.score_value === null ? null : Number(r.score_value)]));
}
