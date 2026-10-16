import type { ConfigKind, LoadedConfig } from "@memebot/shared";
import type { Db } from "./client.ts";

/**
 * Simpan config yang sedang dipakai sebagai versi aktif. Kalau isinya (hash) sudah pernah ada,
 * versi lama itu yang diaktifkan lagi. Return id versi — dicatat di setiap decision/position.
 */
export async function activateConfigVersion<K extends ConfigKind>(
  db: Db,
  cfg: LoadedConfig<K>,
  author: "user" | "llm" | "system" = "user",
  note?: string,
): Promise<number> {
  return db.begin(async (tx) => {
    const [existing] =
      await tx`SELECT id, active FROM config_versions WHERE kind = ${cfg.kind} AND hash = ${cfg.hash}`;
    if (existing?.active) return existing.id as number;
    await tx`UPDATE config_versions SET active = false WHERE kind = ${cfg.kind} AND active`;
    if (existing) {
      await tx`UPDATE config_versions SET active = true WHERE id = ${existing.id}`;
      return existing.id as number;
    }
    const [row] = await tx`
      INSERT INTO config_versions (kind, author, hash, yaml, note, active)
      VALUES (${cfg.kind}, ${author}, ${cfg.hash}, ${cfg.yaml}, ${note ?? null}, true)
      RETURNING id`;
    return row.id as number;
  });
}
