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

  constructor(
    readonly url = process.env.SOLANA_RPC_URL || PUBLIC_RPC,
    private readonly timeoutMs = 8000,
  ) {}

  async call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new RpcError(`RPC ${method} HTTP ${res.status}`, res.status);
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
