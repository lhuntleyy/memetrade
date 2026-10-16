import type { EventBus, Logger, SourcesConfig } from "@memebot/shared";
import { RateLimiter, TtlSet, toNum } from "@memebot/shared";

export type ApiUsageFn = (provider: string, endpoint: string, status: number, latencyMs: number) => void;

/** Satu pair dari `/tokens/v1/solana/{mints}` (field yang kita pakai). */
export interface DexPair {
  dexId: string;
  pairAddress: string;
  priceNative?: string;
  priceUsd?: string;
  liquidity?: { usd?: number } | null;
  marketCap?: number;
  fdv?: number;
  volume?: { m5?: number; h1?: number; h24?: number };
  txns?: { m5?: { buys: number; sells: number }; h1?: { buys: number; sells: number } };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  pairCreatedAt?: number;
  baseToken: { address: string; name?: string; symbol?: string };
  quoteToken?: { address: string; symbol?: string };
}

interface DexListItem {
  chainId: string;
  tokenAddress: string;
  url?: string;
  description?: string;
  amount?: number;
  totalAmount?: number;
  links?: unknown[];
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

/** Client DexScreener dengan rate limiter per kelompok endpoint (profile/boost 60 rpm, pairs 300 rpm). */
export class DexScreenerClient {
  private listLimiter: RateLimiter;
  private pairLimiter: RateLimiter;

  /**
   * proxy: `off` = selalu langsung; `fallback` = langsung, pindah ke proxy selama IP VPS kena 429;
   * `always` = selalu lewat proxy (boros bandwidth — proxy residential dibayar per GB).
   */
  constructor(
    private readonly baseUrl: string,
    rpm: { profiles: number; pairs: number },
    private readonly onUsage: ApiUsageFn = () => {},
    private readonly proxy: { url?: string; mode: "off" | "fallback" | "always" } = { mode: "off" },
  ) {
    // sisakan ~10% headroom dari limit resmi
    this.listLimiter = new RateLimiter(Math.floor(rpm.profiles * 0.9));
    this.pairLimiter = new RateLimiter(Math.floor(rpm.pairs * 0.9));
  }

  /** jalur langsung (IP VPS) dijeda sampai waktu ini setelah 429 */
  private directPausedUntil = 0;
  /** jalur proxy dijeda sampai waktu ini setelah 429 / error */
  private proxyPausedUntil = 0;
  private directStrikes = 0;
  private proxyStrikes = 0;
  stats = { direct: 0, proxy: 0, direct429: 0, proxy429: 0 };

  private get proxyUsable() {
    return Boolean(this.proxy.url) && this.proxy.mode !== "off";
  }

  /** Sisa jeda (detik) sampai ADA jalur yang bisa dipakai. */
  get pausedForSec(): number {
    const now = Date.now();
    const direct = this.proxy.mode === "always" ? Number.POSITIVE_INFINITY : this.directPausedUntil;
    const proxy = this.proxyUsable ? this.proxyPausedUntil : Number.POSITIVE_INFINITY;
    const until = Math.min(direct, proxy);
    return Math.max(0, Math.ceil((until - now) / 1000));
  }

  get route(): "direct" | "proxy" | "paused" {
    const now = Date.now();
    if (this.proxy.mode !== "always" && now >= this.directPausedUntil) return "direct";
    if (this.proxyUsable && now >= this.proxyPausedUntil) return "proxy";
    return "paused";
  }

  private async get<T>(path: string, limiter: RateLimiter, endpoint: string): Promise<T> {
    const route = this.route;
    if (route === "paused")
      throw new Error(`dexscreener ${endpoint} dijeda ${this.pausedForSec} dtk (rate limit)`);
    if (route === "direct") await limiter.take(); // via proxy IP berganti, limiter lokal tidak relevan
    const t0 = performance.now();
    let status = 0;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: AbortSignal.timeout(route === "proxy" ? 15_000 : 8000),
        ...(route === "proxy" ? { proxy: this.proxy.url } : {}),
      });
      status = res.status;
      this.stats[route]++;
      if (res.status === 429) {
        if (route === "direct") {
          this.directStrikes++;
          this.stats.direct429++;
          this.directPausedUntil = Date.now() + Math.min(300_000, 30_000 * 2 ** (this.directStrikes - 1));
        } else {
          this.proxyStrikes++;
          this.stats.proxy429++;
          this.proxyPausedUntil = Date.now() + Math.min(120_000, 5_000 * 2 ** (this.proxyStrikes - 1));
        }
        throw new Error(`dexscreener ${endpoint} HTTP 429 via ${route}`);
      }
      if (!res.ok) throw new Error(`dexscreener ${endpoint} HTTP ${res.status} via ${route}`);
      if (route === "direct") this.directStrikes = Math.max(0, this.directStrikes - 1);
      else this.proxyStrikes = Math.max(0, this.proxyStrikes - 1);
      return (await res.json()) as T;
    } catch (err) {
      // proxy mati / timeout → istirahatkan proxy sebentar
      if (route === "proxy" && status === 0) this.proxyPausedUntil = Date.now() + 30_000;
      throw err;
    } finally {
      this.onUsage(
        route === "proxy" ? "dexscreener_proxy" : "dexscreener",
        endpoint,
        status,
        Math.round(performance.now() - t0),
      );
    }
  }

  latestProfiles() {
    return this.get<DexListItem[]>("/token-profiles/latest/v1", this.listLimiter, "profiles_latest");
  }
  latestBoosts() {
    return this.get<DexListItem[]>("/token-boosts/latest/v1", this.listLimiter, "boosts_latest");
  }
  topBoosts() {
    return this.get<DexListItem[]>("/token-boosts/top/v1", this.listLimiter, "boosts_top");
  }

  /** Maksimal 30 mint per panggilan. */
  async pairs(mints: string[]): Promise<DexPair[]> {
    if (mints.length === 0) return [];
    if (mints.length > 30) throw new RangeError("maksimal 30 mint per request");
    return this.get<DexPair[]>(`/tokens/v1/solana/${mints.join(",")}`, this.pairLimiter, "tokens");
  }
}

/**
 * Pilih pair "utama" untuk satu token: quote SOL dulu, lalu likuiditas terbesar, lalu volume 5m.
 * Pair pump.fun bonding curve tidak punya likuiditas di DexScreener (null) — tetap valid.
 */
export function pickMainPair(pairs: DexPair[], mint: string): DexPair | null {
  const mine = pairs.filter((p) => p.baseToken?.address === mint && toNum(p.priceNative) !== null);
  if (mine.length === 0) return null;
  const score = (p: DexPair) => [
    p.quoteToken?.address === SOL_MINT || p.dexId === "pumpfun" ? 1 : 0,
    p.liquidity?.usd ?? 0,
    p.volume?.m5 ?? 0,
  ];
  return mine.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i]! - sa[i]!;
    return 0;
  })[0]!;
}

/** Poll feed profile & boost DexScreener → TokenTriggered (solana saja, dedupe 6 jam per mint+jenis). */
export function startDexScreenerFeeds(
  cfg: SourcesConfig["dexscreener"],
  client: DexScreenerClient,
  bus: EventBus,
  log: Logger,
) {
  const seen = new TtlSet(6 * 60 * 60_000);
  const timers: Timer[] = [];
  let firstRun = { profile: true, boost: true, boost_top: true };

  const feed = (
    kind: "profile" | "boost" | "boost_top",
    fetcher: () => Promise<DexListItem[]>,
    everySec: number,
  ) => {
    const run = async () => {
      try {
        const items = await fetcher();
        let emitted = 0;
        for (const it of items) {
          if (it.chainId !== "solana" || !it.tokenAddress) continue;
          if (!seen.add(`${it.tokenAddress}:${kind}`)) continue;
          // putaran pertama setelah start = backlog lama; dicatat tapi ditandai supaya stat Trigger Lab bersih
          bus.emit({
            t: "TokenTriggered",
            mint: it.tokenAddress,
            source: "dexscreener",
            kind,
            ts: Date.now(),
            payload: { ...it, backlog: firstRun[kind] },
          });
          emitted++;
        }
        firstRun = { ...firstRun, [kind]: false };
        if (emitted) log.debug({ kind, emitted }, "dexscreener trigger");
      } catch (err) {
        log.warn({ kind, err: String(err) }, "dexscreener feed gagal");
      }
    };
    run();
    timers.push(setInterval(run, everySec * 1000));
  };

  feed("profile", () => client.latestProfiles(), cfg.poll_sec.profiles);
  feed("boost", () => client.latestBoosts(), cfg.poll_sec.boosts_latest);
  feed("boost_top", () => client.topBoosts(), cfg.poll_sec.boosts_top);

  return {
    stop() {
      for (const t of timers) clearInterval(t);
    },
  };
}
