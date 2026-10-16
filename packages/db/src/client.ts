import { SQL } from "bun";

/** Koneksi Postgres via Bun.SQL bawaan. URL dari DATABASE_URL (dev: .env, prod: /etc/memebot/secrets.env). */
export function createDb(url = process.env.DATABASE_URL, opts: { max?: number } = {}) {
  if (!url) throw new Error("DATABASE_URL belum di-set");
  return new SQL({ url, max: opts.max ?? 5, idleTimeout: 30, connectionTimeout: 10 });
}

export type Db = ReturnType<typeof createDb>;
