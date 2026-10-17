/** Token bucket sederhana untuk rate limit per provider. */
export class RateLimiter {
  private tokens: number;
  private last = performance.now();

  /** @param perMinute kapasitas per menit, @param burst maksimum token tersimpan */
  constructor(
    private readonly perMinute: number,
    private readonly burst = Math.max(1, Math.ceil(perMinute / 6)),
  ) {
    this.tokens = this.burst;
  }

  private refill() {
    const now = performance.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 60_000) * this.perMinute);
    this.last = now;
  }

  /** Ambil `weight` token kalau cukup (endpoint berbobot, mis. GMGN holders = 5). */
  tryTake(weight = 1): boolean {
    this.refill();
    if (this.tokens < weight) return false;
    this.tokens -= weight;
    return true;
  }

  /** Tunggu sampai ada `weight` token. weight > burst dibatasi ke burst supaya tidak menunggu selamanya. */
  async take(weight = 1): Promise<void> {
    const w = Math.min(weight, this.burst);
    while (!this.tryTake(w)) {
      const waitMs = ((w - this.tokens) / this.perMinute) * 60_000;
      await Bun.sleep(Math.max(5, Math.ceil(waitMs)));
    }
  }
}

/** Set dengan TTL — untuk dedupe trigger (mint, source, kind). */
export class TtlSet {
  private map = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  /** true kalau key baru (belum ada / sudah kedaluwarsa), lalu dicatat. */
  add(key: string, now = Date.now()): boolean {
    const exp = this.map.get(key);
    if (exp !== undefined && exp > now) return false;
    this.map.set(key, now + this.ttlMs);
    if (this.map.size > 50_000) this.prune(now);
    return true;
  }

  prune(now = Date.now()) {
    for (const [k, exp] of this.map) if (exp <= now) this.map.delete(k);
  }

  get size() {
    return this.map.size;
  }
}

/** Backoff eksponensial dengan jitter, dibatasi maxMs. */
export function backoffMs(attempt: number, baseMs = 1000, maxMs = 60_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 16));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
