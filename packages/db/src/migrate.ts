import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./client.ts";

const MIGRATIONS_DIR = join(import.meta.dir, "../migrations");

/**
 * Runner migrasi SQL sederhana: file `NNNN_nama.sql` dijalankan berurutan, masing-masing dalam satu
 * transaksi, dan dicatat di `schema_migrations`. File yang sudah jalan tidak boleh diubah — buat file baru.
 */
export async function migrate(db: Db, log: (msg: string) => void = console.log): Promise<string[]> {
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;

  const applied = new Map<string, string>(
    (await db`SELECT name, checksum FROM schema_migrations`).map((r: { name: string; checksum: string }) => [
      r.name,
      r.checksum,
    ]),
  );
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const ran: string[] = [];

  for (const name of files) {
    const sqlText = await Bun.file(join(MIGRATIONS_DIR, name)).text();
    const checksum = new Bun.CryptoHasher("sha256").update(sqlText).digest("hex");
    const prev = applied.get(name);
    if (prev) {
      if (prev !== checksum)
        throw new Error(`migrasi ${name} sudah dijalankan tapi isinya berubah — buat file migrasi baru`);
      continue;
    }
    log(`menjalankan migrasi ${name}`);
    await db.begin(async (tx) => {
      await tx.unsafe(sqlText);
      await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${name}, ${checksum})`;
    });
    ran.push(name);
  }
  return ran;
}
