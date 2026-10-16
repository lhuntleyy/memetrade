import type { Db } from "@memebot/db";
import type { EventBus, Logger } from "@memebot/shared";
import { BatchWriter } from "./batch.ts";

interface TriggerRow {
  ts: Date;
  mint: string;
  source: string;
  kind: string;
  payload: unknown;
}
interface TokenRow {
  mint: string;
  symbol: string | null;
  name: string | null;
  creator: string | null;
  launchpad: string | null;
  pool_address: string | null;
  pool_kind: string | null;
  migrated_at: Date | null;
  first_seen_at: Date;
  first_source: string;
}
interface UsageRow {
  ts: Date;
  provider: string;
  endpoint: string;
  status: number;
  latency_ms: number;
}

/** Tulis trigger, master token, dan pemakaian API ke DB secara batch. */
export function startRecorder(bus: EventBus, db: Db, log: Logger) {
  const triggers = new BatchWriter<TriggerRow>(
    "token_triggers",
    async (rows) => {
      await db`INSERT INTO token_triggers ${db(rows)}`;
    },
    log,
  );

  const tokens = new BatchWriter<TokenRow>(
    "tokens",
    async (rows) => {
      // gabungkan duplikat mint dalam satu batch (ON CONFLICT tidak boleh kena baris yang sama dua kali)
      const merged = new Map<string, TokenRow>();
      for (const r of rows) {
        const prev = merged.get(r.mint);
        merged.set(
          r.mint,
          prev
            ? {
                ...prev,
                symbol: prev.symbol ?? r.symbol,
                name: prev.name ?? r.name,
                creator: prev.creator ?? r.creator,
                launchpad: prev.launchpad ?? r.launchpad,
                pool_address: r.pool_address ?? prev.pool_address,
                pool_kind: r.pool_kind ?? prev.pool_kind,
                migrated_at: prev.migrated_at ?? r.migrated_at,
              }
            : r,
        );
      }
      await db`
        INSERT INTO tokens ${db([...merged.values()])}
        ON CONFLICT (mint) DO UPDATE SET
          symbol = COALESCE(tokens.symbol, EXCLUDED.symbol),
          name = COALESCE(tokens.name, EXCLUDED.name),
          creator = COALESCE(tokens.creator, EXCLUDED.creator),
          launchpad = COALESCE(tokens.launchpad, EXCLUDED.launchpad),
          pool_address = COALESCE(EXCLUDED.pool_address, tokens.pool_address),
          pool_kind = COALESCE(EXCLUDED.pool_kind, tokens.pool_kind),
          migrated_at = COALESCE(tokens.migrated_at, EXCLUDED.migrated_at)`;
    },
    log,
  );

  const usage = new BatchWriter<UsageRow>(
    "api_usage",
    async (rows) => {
      await db`INSERT INTO api_usage ${db(rows)}`;
    },
    log,
    5000,
  );

  bus.on("TokenTriggered", (e) => {
    const ts = new Date(e.ts);
    triggers.push({ ts, mint: e.mint, source: e.source, kind: e.kind, payload: e.payload ?? {} });
    tokens.push({
      mint: e.mint,
      symbol: e.meta?.symbol ?? null,
      name: e.meta?.name ?? null,
      creator: e.meta?.creator ?? null,
      launchpad: e.meta?.launchpad ?? null,
      pool_address: e.meta?.poolAddress ?? null,
      pool_kind: e.meta?.poolKind ?? null,
      migrated_at: e.kind === "migration" ? ts : null,
      first_seen_at: ts,
      first_source: `${e.source}.${e.kind}`,
    });
  });

  return {
    recordUsage(provider: string, endpoint: string, status: number, latencyMs: number) {
      usage.push({ ts: new Date(), provider, endpoint, status, latency_ms: latencyMs });
    },
    stats: () => ({
      triggersWritten: triggers.written,
      tokensWritten: tokens.written,
      dropped: triggers.dropped,
    }),
    async stop() {
      await Promise.all([triggers.stop(), tokens.stop(), usage.stop()]);
    },
  };
}
