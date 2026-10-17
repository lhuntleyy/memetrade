import { RateLimiter, toNum } from "@memebot/shared";
import type { ApiUsageFn } from "../collectors/dexscreener.ts";

/**
 * GMGN OpenAPI (read-only). Auth "exist": header X-APIKEY + query timestamp & client_id
 * (dipelajari dari gmgn-cli 1.6.7 — private key hanya untuk swap/order, TIDAK dipakai di sini).
 * IPv4 only. Free tier: leaky bucket 5/5 (info & security masing-masing bobot 1). Request saat sudah
 * kena limit memperpanjang ban (s/d 5 menit) → begitu 429, SEMUA panggilan berhenti sampai reset_at.
 */

const HOST = "https://openapi.gmgn.ai";

export interface GmgnTokenInfo {
  holder_count?: number;
  liquidity?: number;
  creation_timestamp?: number;
  launchpad?: string;
  launchpad_status?: number;
  launchpad_progress?: number;
  dev?: {
    creator_address?: string;
    creator_open_count?: number;
    twitter_create_token_count?: number;
    cto_flag?: number;
    dexscr_update_link?: number;
    dexscr_boost_fee?: number;
  };
  stat?: {
    top_10_holder_rate?: number;
    top_bundler_trader_percentage?: number;
    top_rat_trader_percentage?: number;
    top_entrapment_trader_percentage?: number;
    bot_degen_rate?: number;
    fresh_wallet_rate?: number;
    dev_team_hold_rate?: number;
    creator_hold_rate?: number;
    creator_created_count?: number;
    top70_sniper_hold_rate?: number;
    private_vault_hold_rate?: number;
  };
  wallet_tags_stat?: {
    smart_wallets?: number;
    renowned_wallets?: number;
    sniper_wallets?: number;
    bundler_wallets?: number;
    rat_trader_wallets?: number;
  };
}

export interface GmgnSecurity {
  is_honeypot?: boolean | null;
  honeypot?: number | null;
  can_not_sell?: number | null;
  buy_tax?: number | string | null;
  sell_tax?: number | string | null;
  renounced_mint?: boolean | null;
  renounced_freeze_account?: boolean | null;
  top_10_holder_rate?: number | string | null;
  burn_ratio?: number | string | null;
}

export interface GmgnData {
  info: GmgnTokenInfo | null;
  security: GmgnSecurity | null;
}

export class GmgnClient {
  // free tier: leaky bucket 5/5 (≈5 bobot/dtk). Kita pakai ±2 bobot/dtk, burst 5 (cukup untuk 1 panggilan holders).
  private limiter = new RateLimiter(120, 5);
  private pausedUntil = 0;
  stats = { ok: 0, rateLimited: 0, skippedPaused: 0 };

  get pausedForSec() {
    return Math.max(0, Math.ceil((this.pausedUntil - Date.now()) / 1000));
  }

  constructor(
    private readonly apiKey: string,
    private readonly onUsage: ApiUsageFn = () => {},
  ) {}

  private async get<T>(path: string, query: Record<string, string>, weight = 1): Promise<T | null> {
    if (Date.now() < this.pausedUntil) {
      this.stats.skippedPaused++;
      throw new Error(`gmgn dijeda ${this.pausedForSec} dtk (rate limit)`);
    }
    await this.limiter.take(weight);
    const qs = new URLSearchParams({
      ...query,
      timestamp: String(Math.floor(Date.now() / 1000)),
      client_id: crypto.randomUUID(),
    });
    const t0 = performance.now();
    let status = 0;
    try {
      const res = await fetch(`${HOST}${path}?${qs}`, {
        headers: { "X-APIKEY": this.apiKey, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
      const body = (await res.json().catch(() => null)) as {
        code?: number;
        data?: T;
        error?: string;
        reset_at?: number;
      } | null;
      if (res.status === 429 || body?.code === 429) {
        this.stats.rateLimited++;
        const resetMs = (body?.reset_at ?? Number(res.headers.get("x-ratelimit-reset")) ?? 0) * 1000;
        // jeda sampai reset + 2 dtk (minimal 30 dtk, maksimal 6 menit)
        this.pausedUntil = Math.min(Date.now() + 360_000, Math.max(Date.now() + 30_000, resetMs + 2000));
        throw new Error(`gmgn ${path} 429 ${body?.error ?? ""} — jeda ${this.pausedForSec} dtk`);
      }
      if (!res.ok || !body || body.code !== 0) {
        if (body?.error) status = status || 599;
        throw new Error(`gmgn ${path} HTTP ${res.status} ${body?.error ?? ""}`.trim());
      }
      this.stats.ok++;
      return body.data ?? null;
    } finally {
      this.onUsage("gmgn", path, status, Math.round(performance.now() - t0));
    }
  }

  /** Top holder (bobot 5 = satu bucket penuh free tier). Urut berdasarkan % supply. */
  async topHolders(mint: string, limit = 50): Promise<GmgnHolder[] | null> {
    const data = await this.get<{ list?: GmgnHolder[] }>(
      "/v1/market/token_top_holders",
      { chain: "sol", address: mint, limit: String(limit), order_by: "amount_percentage", direction: "desc" },
      5,
    );
    return data?.list ?? null;
  }

  async token(mint: string): Promise<GmgnData> {
    const q = { chain: "sol", address: mint };
    // berurutan (bukan paralel) supaya tidak meledakkan bucket 5/5
    const info = await this.get<GmgnTokenInfo>("/v1/token/info", q).catch(() => null);
    const security = await this.get<GmgnSecurity>("/v1/token/security", q).catch(() => null);
    return { info, security };
  }
}

export interface GmgnHolder {
  address: string;
  addr_type?: number;
  exchange?: string;
  usd_value?: number;
  amount_percentage?: number;
  buy_volume_cur?: number;
  sell_volume_cur?: number;
  profit?: number;
  realized_profit?: number;
  unrealized_profit?: number;
  is_on_curve?: boolean;
  is_suspicious?: boolean;
  tags?: string[];
  maker_token_tags?: string[];
  wallet_tag_v2?: string;
  start_holding_at?: number;
  last_active_timestamp?: number;
  twitter_username?: string | null;
  name?: string | null;
}

const pct = (v: unknown) => {
  const n = toNum(v);
  return n === null ? null : Math.round(n * 10_000) / 100; // rasio 0..1 → persen
};

/** Fitur dari GMGN dalam persen (0–100). null kalau tidak tersedia. */
export function gmgnFeatures(d: GmgnData | null): Record<string, number | boolean | null> {
  if (!d?.info && !d?.security) return {};
  const st = d.info?.stat ?? {};
  const tags = d.info?.wallet_tags_stat ?? {};
  return {
    top10_pct: pct(st.top_10_holder_rate ?? d.security?.top_10_holder_rate),
    bundler_pct: pct(st.top_bundler_trader_percentage),
    sniper_pct: pct(st.top70_sniper_hold_rate),
    rat_trader_pct: pct(st.top_rat_trader_percentage),
    entrapment_pct: pct(st.top_entrapment_trader_percentage),
    bot_degen_pct: pct(st.bot_degen_rate),
    fresh_wallet_pct: pct(st.fresh_wallet_rate),
    dev_hold_pct: pct(st.creator_hold_rate),
    dev_team_hold_pct: pct(st.dev_team_hold_rate),
    dev_created_count: toNum(st.creator_created_count),
    smart_wallets: toNum(tags.smart_wallets),
    renowned_wallets: toNum(tags.renowned_wallets),
    gmgn_holders: toNum(d.info?.holder_count),
    gmgn_liquidity_usd: toNum(d.info?.liquidity),
    dex_paid: d.info?.dev ? Boolean(d.info.dev.dexscr_update_link) : null,
    cto: d.info?.dev ? Boolean(d.info.dev.cto_flag) : null,
    sell_tax_pct: pct(d.security?.sell_tax),
    buy_tax_pct: pct(d.security?.buy_tax),
  };
}

/** Alasan security tambahan dari GMGN (honeypot / tidak bisa jual / pajak tinggi). */
export function gmgnSecurityReasons(d: GmgnData | null, maxTaxPct = 10): string[] {
  const s = d?.security;
  if (!s) return [];
  const reasons: string[] = [];
  if (s.is_honeypot === true || s.honeypot === 1) reasons.push("gmgn_honeypot");
  if (s.can_not_sell === 1) reasons.push("gmgn_cannot_sell");
  const sell = pct(s.sell_tax);
  const buy = pct(s.buy_tax);
  if (sell !== null && sell > maxTaxPct) reasons.push(`gmgn_sell_tax_${sell}pct`);
  if (buy !== null && buy > maxTaxPct) reasons.push(`gmgn_buy_tax_${buy}pct`);
  return reasons;
}
