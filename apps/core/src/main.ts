import { activateConfigVersion, createDb } from "@memebot/db";
import {
  type ConfigKind,
  configSchemas,
  createLogger,
  type Event,
  EventBus,
  type LoadedConfig,
  loadConfig,
  watchConfig,
} from "@memebot/shared";
import { startControlServer } from "./control.ts";
import { KillSwitch } from "./kill-switch.ts";

const log = createLogger("core");
const db = createDb(process.env.DATABASE_URL, { max: 8 });
const bus = new EventBus((err, e) => log.error({ err, event: e.t }, "handler event error"));

// ---- config: load, catat versi aktif, hot reload ----
const configs = {} as { [K in ConfigKind]: LoadedConfig<K> };
const configVersion = {} as Record<ConfigKind, number>;
const unwatch: (() => void)[] = [];

for (const kind of Object.keys(configSchemas) as ConfigKind[]) {
  const cfg = await loadConfig(kind);
  (configs as Record<ConfigKind, LoadedConfig<ConfigKind>>)[kind] = cfg;
  configVersion[kind] = await activateConfigVersion(db, cfg, "user", "loaded at startup");
  unwatch.push(
    watchConfig(
      cfg,
      async (next) => {
        (configs as Record<ConfigKind, LoadedConfig<ConfigKind>>)[kind] = next;
        configVersion[kind] = await activateConfigVersion(db, next, "user", "hot reload");
        log.info({ kind, version: configVersion[kind] }, "config di-reload");
        bus.emit({ t: "Control", action: "reload", actor: "file-watch", scope: kind });
      },
      (err) => log.error({ kind, err: String(err) }, "config baru tidak valid — tetap pakai versi lama"),
    ),
  );
}
log.info({ mode: configs.trade.data.mode, versions: configVersion }, "config aktif");

// ---- kill switch ----
const kill = new KillSwitch(configs.trade.data.kill_switch.file_flag);

// ---- control API lokal (dashboard ambil status & event dari sini) ----
const startedAt = Date.now();
const control = startControlServer({
  port: Number(process.env.CORE_CONTROL_PORT ?? 7071),
  secret: process.env.CONTROL_SECRET,
  bus,
  log,
  status: () => ({
    service: "core",
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    mode: configs.trade.data.mode,
    killed: kill.active,
    killReason: kill.reason,
    configVersion,
    profiles: Object.fromEntries(Object.entries(configs.strategy.data.profiles).map(([n, p]) => [n, p.mode])),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  }),
  onControl: async (action, actor) => {
    await db`INSERT INTO control_events (actor, action) VALUES (${actor}, ${action})`;
    if (action === "kill" || action === "pause") kill.engage(`${action} oleh ${actor}`);
    if (action === "resume") kill.release();
    // "panic" (jual semua) diimplementasi bersama position manager di Fase 3
    bus.emit({ t: "Control", action, actor });
  },
});

// ---- heartbeat → system_events tiap 60 dtk ----
let lastBeat = performance.now();
const heartbeat = setInterval(async () => {
  const now = performance.now();
  const lagMs = Math.max(0, Math.round(now - lastBeat - 60_000));
  lastBeat = now;
  const rssMb = Math.round(process.memoryUsage().rss / 1048576);
  const e: Event = { t: "Heartbeat", service: "core", ts: Date.now(), lagMs, rssMb };
  bus.emit(e);
  try {
    await db`INSERT INTO system_events (level, service, kind, data) VALUES ('info', 'core', 'heartbeat', ${{ lagMs, rssMb, killed: kill.active }})`;
  } catch (err) {
    log.error({ err: String(err) }, "gagal tulis heartbeat");
  }
}, 60_000);

await db`INSERT INTO system_events (level, service, kind, message) VALUES ('info', 'core', 'start', 'core started')`;
log.info({ port: control.port }, "memebot-core siap (Fase 0: belum ada collector/trading)");

// ---- shutdown rapi ----
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "berhenti...");
  clearInterval(heartbeat);
  for (const u of unwatch) u();
  kill.stop();
  control.stop();
  try {
    await db`INSERT INTO system_events (level, service, kind, message) VALUES ('info', 'core', 'stop', ${signal})`;
  } finally {
    await db.close();
    process.exit(0);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
