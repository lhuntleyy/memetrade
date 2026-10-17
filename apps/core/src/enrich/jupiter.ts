import { RateLimiter, toNum } from "@memebot/shared";
import type { ApiUsageFn } from "../collectors/dexscreener.ts";

/**
 * Jupiter Tokens API v2 (`/tokens/v2/search?query=<mint>`). Keyless ±0.5 RPS, free key 1 RPS.
 * Dipakai untuk holderCount, organicScore, audit (dev balance, jumlah mint dev), stats 5m.
 * Base URL: `https://api.jup.ag` + JUPITER_API_KEY kalau ada, selain itu lite-api (masih jalan per 2026-10-17).
 */

interface JupStats {
  priceChange?: number;
  buyVolume?: number;
  sellVolume?: number;
  numBuys?: number;
  numSells?: number;
  numTraders?: number;
  numNetBuyers?: number;
}

export interface JupToken {
  id: string;
  name?: string;
  symbol?: string;
  dev?: string;
  tokenProgram?: string;
  launchpad?: string;
  holderCount?: number;
  mcap?: number;
  usdPrice?: number;
  liquidity?: number;
  organicScore?: number;
  stats5m?: JupStats;
  stats1h?: JupStats;
  audit?: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    topHoldersPercentage?: number;
    devBalancePercentage?: number;
    devMints?: number;
    isSus?: boolean;
  };
  firstPool?: { id: string; createdAt: string };
  createdAt?: string;
}

export class JupiterTokens {
  private limiter: RateLimiter;
  private base: string;
  private headers: Record<string, string>;

  constructor(private readonly onUsage: ApiUsageFn = () => {}) {
    const key = process.env.JUPITER_API_KEY;
    this.base = key ? "https://api.jup.ag" : "https://lite-api.jup.ag";
    this.headers = key ? { "x-api-key": key } : {};
    // key free ≈ 1 req/dtk dibagi dengan quote posisi (prioritas) → tokens cukup 15/menit; keyless 0.5 RPS → 25
    this.limiter = new RateLimiter(key ? 15 : 25, 2);
  }

  async token(mint: string): Promise<JupToken | null> {
    await this.limiter.take();
    const t0 = performance.now();
    let status = 0;
    try {
      const res = await fetch(`${this.base}/tokens/v2/search?query=${encodeURIComponent(mint)}`, {
        headers: this.headers,
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
      if (!res.ok) throw new Error(`jupiter tokens HTTP ${res.status}`);
      const list = (await res.json()) as JupToken[];
      return list.find((t) => t.id === mint) ?? null;
    } finally {
      this.onUsage("jupiter", "tokens_v2_search", status, Math.round(performance.now() - t0));
    }
  }
}

/** Fitur dari data Jupiter (null kalau tidak tersedia — JANGAN diisi 0). */
export function jupiterFeatures(t: JupToken | null): Record<string, number | boolean | null> {
  if (!t) return {};
  const s5 = t.stats5m ?? {};
  const buys = toNum(s5.numBuys);
  const sells = toNum(s5.numSells);
  return {
    holders: toNum(t.holderCount),
    organic_score: toNum(t.organicScore),
    dev_pct: toNum(t.audit?.devBalancePercentage),
    dev_mints: toNum(t.audit?.devMints),
    top_holders_pct: toNum(t.audit?.topHoldersPercentage),
    jup_is_sus: t.audit?.isSus ?? null,
    traders_5m: toNum(s5.numTraders),
    net_buyers_5m: toNum(s5.numNetBuyers),
    jup_buy_sell_ratio_5m: buys !== null && sells !== null ? (sells === 0 ? buys : buys / sells) : null,
    jup_liquidity_usd: toNum(t.liquidity),
    jup_mcap_usd: toNum(t.mcap),
  };
}
