import { toNum } from "@memebot/shared";
import type { DexPair } from "../collectors/dexscreener.ts";

export type FeatureValue = number | boolean | string | null;
export type Features = Record<string, FeatureValue>;

/** Fitur dari pair DexScreener. Field yang tidak ada = null (bukan 0). */
export function dexFeatures(pair: DexPair | null, now = Date.now()): Features {
  if (!pair) return {};
  const t5 = pair.txns?.m5;
  const buys = toNum(t5?.buys);
  const sells = toNum(t5?.sells);
  return {
    dex_id: pair.dexId,
    price_usd: toNum(pair.priceUsd),
    price_sol: toNum(pair.priceNative),
    liquidity_usd: toNum(pair.liquidity?.usd),
    mcap_usd: toNum(pair.marketCap ?? pair.fdv),
    vol_5m_usd: toNum(pair.volume?.m5),
    vol_1h_usd: toNum(pair.volume?.h1),
    txns_5m: buys !== null && sells !== null ? buys + sells : null,
    buy_sell_ratio_5m: buys !== null && sells !== null ? (sells === 0 ? buys : buys / sells) : null,
    price_change_5m: toNum(pair.priceChange?.m5),
    price_change_1h: toNum(pair.priceChange?.h1),
    age_min: pair.pairCreatedAt ? Math.max(0, (now - pair.pairCreatedAt) / 60_000) : null,
  };
}

/** Gabung fitur beberapa sumber; sumber pertama yang punya nilai non-null menang. */
export function mergeFeatures(...sources: Features[]): Features {
  const out: Features = {};
  for (const src of sources) {
    for (const [k, v] of Object.entries(src)) {
      if (out[k] === undefined || out[k] === null) out[k] = v;
    }
  }
  // fallback likuiditas pump.fun bonding curve (DexScreener null) → Jupiter
  if (out.liquidity_usd === null || out.liquidity_usd === undefined)
    out.liquidity_usd = out.jup_liquidity_usd ?? null;
  if (out.mcap_usd === null || out.mcap_usd === undefined) out.mcap_usd = out.jup_mcap_usd ?? null;
  if (out.buy_sell_ratio_5m === null || out.buy_sell_ratio_5m === undefined)
    out.buy_sell_ratio_5m = out.jup_buy_sell_ratio_5m ?? null;
  return out;
}
