import { rename, writeFile } from "node:fs/promises";
import { activateConfigVersion, type Db } from "@memebot/db";
import {
  ConfigError,
  type ConfigKind,
  configSchemas,
  type LoadedConfig,
  type Logger,
  parseConfig,
} from "@memebot/shared";

/**
 * Administrasi config dari dashboard: baca, validasi + diff, simpan (versi baru), riwayat, rollback.
 * File ditulis atomik (tmp + rename) ke direktori config live; watcher core yang memuat ulang.
 * Pengaman: config yang mengaktifkan mode LIVE ditolak kecuali env MEMEBOT_ALLOW_LIVE_CONFIG=1.
 */

const KINDS = Object.keys(configSchemas) as ConfigKind[];

export function isConfigKind(k: string): k is ConfigKind {
  return (KINDS as string[]).includes(k);
}

/** Diff baris sederhana (LCS) → baris berawalan "  ", "- ", "+ ". Cukup untuk file config ratusan baris. */
export function lineDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push(`- ${a[i++]}`);
    else out.push(`+ ${b[j++]}`);
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out.join("\n");
}

/** Hanya baris yang berubah (+ konteks 2 baris) — untuk ditampilkan/disimpan. */
export function compactDiff(diff: string, context = 2): string {
  const lines = diff.split("\n");
  const keep = new Set<number>();
  lines.forEach((l, idx) => {
    if (l.startsWith("+ ") || l.startsWith("- "))
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++)
        keep.add(k);
  });
  const out: string[] = [];
  let last = -2;
  for (const idx of [...keep].sort((x, y) => x - y)) {
    if (idx > last + 1 && out.length) out.push("  …");
    out.push(lines[idx]!);
    last = idx;
  }
  return out.join("\n");
}

/** Alasan penolakan kalau config mencoba mengaktifkan mode live. */
export function liveGuard(kind: ConfigKind, data: unknown): string[] {
  if (process.env.MEMEBOT_ALLOW_LIVE_CONFIG === "1") return [];
  const reasons: string[] = [];
  if (kind === "trade" && (data as { mode?: string }).mode === "live") reasons.push("trade.mode = live");
  if (kind === "strategy") {
    const profiles = (data as { profiles?: Record<string, { mode?: string }> }).profiles ?? {};
    for (const [name, p] of Object.entries(profiles))
      if (p.mode === "live") reasons.push(`profiles.${name}.mode = live`);
  }
  return reasons;
}

export interface ValidateResult {
  ok: boolean;
  issues: string[];
  blocked: string[];
  diff: string;
  changed: boolean;
}

export class ConfigAdmin {
  constructor(
    private readonly db: Db,
    private readonly current: (kind: ConfigKind) => LoadedConfig<ConfigKind>,
    private readonly log: Logger,
  ) {}

  validate(kind: ConfigKind, yaml: string): ValidateResult {
    const cur = this.current(kind);
    const diff = compactDiff(lineDiff(cur.yaml, yaml));
    try {
      const parsed = parseConfig(kind, yaml);
      const blocked = liveGuard(kind, parsed.data);
      return { ok: blocked.length === 0, issues: [], blocked, diff, changed: parsed.hash !== cur.hash };
    } catch (e) {
      const issues = e instanceof ConfigError ? e.issues : [String(e)];
      return { ok: false, issues, blocked: [], diff, changed: true };
    }
  }

  /** Simpan sebagai versi baru lalu tulis file (watcher core memuat ulang). */
  async save(kind: ConfigKind, yaml: string, actor: string, note: string | null) {
    const v = this.validate(kind, yaml);
    if (!v.ok) return { ...v, ok: false as const };
    if (!v.changed) return { ...v, ok: true as const, version: null, unchanged: true };
    const cur = this.current(kind);
    const parsed = parseConfig(kind, yaml, cur.path);
    const label = `${actor}${note ? `: ${note}` : ""}`;
    // catat versi dulu (aktif) supaya watcher menemukan hash yang sama dan tidak membuat versi "hot reload"
    const version = await activateConfigVersion(this.db, parsed, "user", label);
    await this.db`UPDATE config_versions SET diff = ${v.diff} WHERE id = ${version} AND diff IS NULL`;
    const tmp = `${cur.path}.tmp-${process.pid}`;
    await writeFile(tmp, yaml, { mode: 0o640 });
    await rename(tmp, cur.path);
    this.log.warn({ kind, version, actor, note }, "config disimpan dari dashboard");
    return { ...v, ok: true as const, version, unchanged: false };
  }

  async versions(kind: ConfigKind, limit = 50) {
    return this.db`
      SELECT id, created_at, author, note, active, left(hash, 12) AS hash, length(yaml) AS size,
             (diff IS NOT NULL) AS has_diff
      FROM config_versions WHERE kind = ${kind} ORDER BY id DESC LIMIT ${limit}`;
  }

  async version(kind: ConfigKind, id: number) {
    const [row] = await this
      .db`SELECT id, created_at, author, note, active, yaml, diff FROM config_versions WHERE kind = ${kind} AND id = ${id}`;
    return row ?? null;
  }

  async rollback(kind: ConfigKind, id: number, actor: string) {
    const v = await this.version(kind, id);
    if (!v)
      return { ok: false as const, issues: [`versi ${id} tidak ada`], blocked: [], diff: "", changed: false };
    return this.save(kind, String(v.yaml), actor, `rollback ke v${id}`);
  }

  /** Router HTTP untuk control API core (sudah terautentikasi). null = bukan rute config. */
  async handle(req: Request, url: URL, actor: string): Promise<Response | null> {
    const m = url.pathname.match(/^\/config\/([a-z]+)(?:\/(validate|versions|rollback)(?:\/(\d+))?)?$/);
    if (!m) return null;
    const [, kindRaw, action, idRaw] = m;
    if (!kindRaw || !isConfigKind(kindRaw))
      return Response.json({ error: "jenis config tidak dikenal" }, { status: 400 });
    const kind = kindRaw;
    const body = async () => (await req.json().catch(() => ({}))) as { yaml?: string; note?: string };

    if (!action && req.method === "GET") {
      const c = this.current(kind);
      const [ver] = await this.db`SELECT id FROM config_versions WHERE kind = ${kind} AND active`;
      return Response.json({ kind, yaml: c.yaml, hash: c.hash, version: ver?.id ?? null });
    }
    if (!action && req.method === "POST") {
      const b = await body();
      if (typeof b.yaml !== "string" || b.yaml.length > 200_000)
        return Response.json({ error: "yaml wajib" }, { status: 400 });
      const r = await this.save(kind, b.yaml, actor, b.note?.slice(0, 200) ?? null);
      return Response.json(r, { status: r.ok ? 200 : 422 });
    }
    if (action === "validate" && req.method === "POST") {
      const b = await body();
      if (typeof b.yaml !== "string") return Response.json({ error: "yaml wajib" }, { status: 400 });
      return Response.json(this.validate(kind, b.yaml));
    }
    if (action === "versions" && req.method === "GET") {
      if (idRaw) {
        const v = await this.version(kind, Number(idRaw));
        return v ? Response.json(v) : Response.json({ error: "tidak ada" }, { status: 404 });
      }
      return Response.json(await this.versions(kind));
    }
    if (action === "rollback" && idRaw && req.method === "POST") {
      const r = await this.rollback(kind, Number(idRaw), actor);
      return Response.json(r, { status: r.ok ? 200 : 422 });
    }
    return Response.json({ error: "rute config tidak dikenal" }, { status: 404 });
  }
}
