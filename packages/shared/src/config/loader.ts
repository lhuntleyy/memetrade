import { watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse } from "yaml";
import type { z } from "zod";
import { type ConfigKind, type ConfigOf, configSchemas } from "./schema.ts";

export interface LoadedConfig<K extends ConfigKind> {
  kind: K;
  data: ConfigOf<K>;
  /** isi YAML mentah — disimpan ke config_versions */
  yaml: string;
  /** sha256 hex dari YAML mentah, buat deteksi perubahan */
  hash: string;
  path: string;
}

export class ConfigError extends Error {
  constructor(
    readonly kind: ConfigKind,
    readonly issues: string[],
  ) {
    super(`config '${kind}' tidak valid:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
}

export function parseConfig<K extends ConfigKind>(
  kind: K,
  yaml: string,
  path = `<${kind}>`,
): LoadedConfig<K> {
  let raw: unknown;
  try {
    raw = parse(yaml);
  } catch (e) {
    throw new ConfigError(kind, [`YAML rusak: ${(e as Error).message}`]);
  }
  const result = configSchemas[kind].safeParse(raw);
  if (!result.success) throw new ConfigError(kind, formatIssues(result.error));
  const hash = new Bun.CryptoHasher("sha256").update(yaml).digest("hex");
  return { kind, data: result.data as ConfigOf<K>, yaml, hash, path };
}

export async function loadConfig<K extends ConfigKind>(
  kind: K,
  dir = defaultConfigDir(),
): Promise<LoadedConfig<K>> {
  const path = join(dir, `${kind}.yaml`);
  const file = Bun.file(path);
  if (!(await file.exists())) throw new ConfigError(kind, [`file tidak ditemukan: ${path}`]);
  return parseConfig(kind, await file.text(), path);
}

export function defaultConfigDir(): string {
  return process.env.MEMEBOT_CONFIG_DIR ?? join(import.meta.dir, "../../../../config");
}

/**
 * Pantau file config (lewat direktorinya, tahan terhadap penulisan atomik). Callback hanya dipanggil kalau config baru VALID dan isinya berubah;
 * config invalid dilaporkan lewat onError dan config lama tetap dipakai.
 */
export function watchConfig<K extends ConfigKind>(
  current: LoadedConfig<K>,
  onChange: (next: LoadedConfig<K>) => void,
  onError: (err: unknown) => void,
  debounceMs = 300,
): () => void {
  let timer: Timer | undefined;
  let last = current.hash;
  // pantau DIREKTORI, bukan file: penulisan atomik (tmp + rename) mengganti inode dan memutus watcher file
  const file = basename(current.path);
  const watcher = watch(dirname(current.path), (_event, name) => {
    if (name !== null && name !== file) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const next = parseConfig(current.kind, await Bun.file(current.path).text(), current.path);
        if (next.hash === last) return;
        last = next.hash;
        onChange(next);
      } catch (e) {
        onError(e);
      }
    }, debounceMs);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/** Mode efektif profile: global paper selalu menang atas profile live. */
export function effectiveMode(globalMode: "paper" | "live", profileMode: "off" | "paper" | "live") {
  if (profileMode === "off") return "off" as const;
  return globalMode === "paper" ? ("paper" as const) : profileMode;
}
