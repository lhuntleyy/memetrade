/**
 * Client JSON-RPC Solana minimal (fetch). URL dari SOLANA_RPC_URL; tanpa itu pakai RPC publik
 * (rate limit ketat — cukup untuk cek security beberapa token per menit, bukan untuk produksi).
 */

export const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface ParsedMintInfo {
  decimals: number;
  supply: string;
  isInitialized: boolean;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions?: { extension: string; state?: Record<string, unknown> }[];
}

export interface MintAccount {
  owner: string;
  program: string;
  info: ParsedMintInfo;
}

export class SolanaRpc {
  private id = 0;
  readonly urls: string[];
  /** url → waktu (ms) sampai boleh dipakai lagi setelah 429/5xx/timeout */
  private coolUntil = new Map<string, number>();

  /**
   * @param urls urutan prioritas. Default: SOLANA_RPC_URL (mis. Helius) lalu RPC publik sebagai cadangan.
   * Kalau satu endpoint kena 429 / 5xx / timeout, endpoint itu diistirahatkan 60 dtk dan request pindah ke berikutnya.
   */
  constructor(
    urls: string[] = [process.env.SOLANA_RPC_URL, PUBLIC_RPC].filter((u): u is string => Boolean(u)),
    private readonly timeoutMs = 8000,
    private readonly cooldownMs = 60_000,
  ) {
    this.urls = [...new Set(urls)];
  }

  /** Host endpoint (tanpa query/api-key) — aman untuk log/status. */
  hosts(): { host: string; coolingDown: boolean }[] {
    const now = Date.now();
    return this.urls.map((u) => ({ host: new URL(u).host, coolingDown: (this.coolUntil.get(u) ?? 0) > now }));
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const now = Date.now();
    const ready = this.urls.filter((u) => (this.coolUntil.get(u) ?? 0) <= now);
    const order = ready.length ? ready : this.urls;
    let lastErr: unknown;
    for (const url of order) {
      try {
        return await this.callOne<T>(url, method, params);
      } catch (err) {
        lastErr = err;
        const retryable = !(err instanceof RpcError) || err.code === 429 || (err.code ?? 0) >= 500;
        if (!retryable) throw err;
        this.coolUntil.set(url, Date.now() + this.cooldownMs);
      }
    }
    throw lastErr;
  }

  private async callOne<T>(url: string, method: string, params: unknown[]): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new RpcError(`RPC ${method} HTTP ${res.status} (${new URL(url).host})`, res.status);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) throw new RpcError(`RPC ${method}: ${body.error.message}`, body.error.code);
    return body.result as T;
  }

  /** Akun mint (jsonParsed — RPC sudah mem-parse extension Token-2022). null kalau tidak ada / bukan mint. */
  async getMint(mint: string): Promise<MintAccount | null> {
    const r = await this.call<{
      value: {
        owner: string;
        data: { program: string; parsed?: { type: string; info: ParsedMintInfo } };
      } | null;
    }>("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
    const v = r.value;
    if (v?.data?.parsed?.type !== "mint") return null;
    return { owner: v.owner, program: v.data.program, info: v.data.parsed.info };
  }
}

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
