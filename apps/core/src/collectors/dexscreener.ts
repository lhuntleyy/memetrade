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

  constructor(
    private readonly baseUrl: string,
    rpm: { profiles: number; pairs: number },
    private readonly onUsage: ApiUsageFn = () => {},
  ) {
    // sisakan ~10% headroom dari limit resmi
    this.listLimiter = new RateLimiter(Math.floor(rpm.profiles * 0.9));
    this.pairLimiter = new RateLimiter(Math.floor(rpm.pairs * 0.9));
  }

  private async get<T>(path: string, limiter: RateLimiter, endpoint: string): Promise<T> {
    await limiter.take();
    const t0 = performance.now();
    let status = 0;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(8000) });
      status = res.status;
      if (!res.ok) throw new Error(`dexscreener ${endpoint} HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      this.onUsage("dexscreener", endpoint, status, Math.round(performance.now() - t0));
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
