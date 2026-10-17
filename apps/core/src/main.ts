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
import { SolanaRpc } from "@memebot/solana";
import { DexScreenerClient, startDexScreenerFeeds } from "./collectors/dexscreener.ts";
import { startPumpPortal } from "./collectors/pumpportal.ts";
import { startControlServer } from "./control.ts";
import { GmgnClient } from "./enrich/gmgn.ts";
import { JupiterTokens } from "./enrich/jupiter.ts";
import { startRecorder } from "./journal/recorder.ts";
import { KillSwitch } from "./kill-switch.ts";
import { MarketTracker } from "./market/tracker.ts";
import { Pipeline } from "./strategy/pipeline.ts";
import { PaperExecutor } from "./trading/paper-executor.ts";
import { PositionManager } from "./trading/position-manager.ts";
import { WalletTracker } from "./wallets/tracker.ts";

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

// ---- Fase 1: recorder, collectors, market tracker ----
// Catatan: perubahan sources.yaml baru berlaku setelah restart core.
const recorder = startRecorder(bus, db, log);
const src = configs.sources.data;
const dex = new DexScreenerClient(src.dexscreener.base_url, src.dexscreener.rpm, recorder.recordUsage, {
  url: process.env.DEXSCREENER_PROXY_URL || undefined,
  mode: src.dexscreener.proxy_mode,
});
const tracker = new MarketTracker(src.tracker, dex, bus, db, log);
log.info(await tracker.resume(), "tracked paths dipulihkan setelah restart");
const pump = src.pumpportal.enabled ? startPumpPortal(src.pumpportal, bus, log) : null;
const dexFeeds = src.dexscreener.enabled ? startDexScreenerFeeds(src.dexscreener, dex, bus, log) : null;
// ---- Fase 2: enrichment + security + filter (decision log, tanpa entry) ----
const rpc = new SolanaRpc();
if (!process.env.SOLANA_RPC_URL)
  log.warn("SOLANA_RPC_URL belum di-set — pakai RPC publik (rate limit ketat)");
const gmgn = process.env.GMGN_API_KEY ? new GmgnClient(process.env.GMGN_API_KEY, recorder.recordUsage) : null;
const pipeline = new Pipeline({
  bus,
  db,
  log,
  tracker,
  jupiter: new JupiterTokens(recorder.recordUsage),
  gmgn,
  rpc,
  strategy: () => configs.strategy.data,
  strategyVersion: () => configVersion.strategy,
});
// ---- Fase 3: paper trading (risk → paper executor → exit engine) ----
const symbols = new Map<string, string>();
bus.on("TokenTriggered", (e) => {
  if (e.meta?.symbol) symbols.set(e.mint, e.meta.symbol);
  if (symbols.size > 20_000) symbols.delete(symbols.keys().next().value!);
});
const executor = new PaperExecutor(
  () => configs.trade.data,
  rpc,
  (mint) => {
    const pair = tracker.latestPair(mint, 120_000);
    const priceSol = Number(pair?.priceNative);
    if (!pair || !(priceSol > 0)) return null;
    return { priceSol, liquidityUsd: pair.liquidity?.usd ?? null, priceUsd: Number(pair.priceUsd) || null };
  },
  recorder.recordUsage,
);
const positions = new PositionManager({
  bus,
  db,
  log,
  tracker,
  executor,
  trade: () => configs.trade.data,
  strategy: () => configs.strategy.data,
  strategyVersion: () => configVersion.strategy,
  killed: () => kill.active,
  symbolOf: (mint) => symbols.get(mint) ?? null,
});

// ---- wallet tracker (top holder & pembeli besar, data GMGN) ----
const wallets = gmgn
  ? new WalletTracker(
      () => configs.sources.data.wallet_tracker,
      gmgn,
      db,
      log,
      bus,
      (m) => symbols.get(m) ?? null,
    )
  : null;
if (!wallets) log.warn("wallet tracker nonaktif (GMGN_API_KEY tidak ada)");

if (src.gmgn.enabled)
  log.warn(
    "collector trigger GMGN (trending/trenches) belum diimplementasi — enrichment GMGN tetap aktif kalau GMGN_API_KEY ada",
  );
if (src.meteora.enabled) log.warn("collector Meteora belum diimplementasi — dilewati");

const triggerCounts: Record<string, number> = {};
bus.on("TokenTriggered", (e) => {
  const k = `${e.source}.${e.kind}`;
  triggerCounts[k] = (triggerCounts[k] ?? 0) + 1;
});

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
    collectors: {
      pumpportal: pump
        ? {
            connected: pump.connected,
            lastMessageAgoSec: Math.round((Date.now() - pump.lastMessageAt) / 1000),
          }
        : "off",
      dexscreener: dexFeeds ? { route: dex.route, pausedForSec: dex.pausedForSec, ...dex.stats } : "off",
    },
    tracker: { activeTokens: tracker.activeTokens, activePaths: tracker.activePaths, ...tracker.stats },
    triggers: triggerCounts,
    pipeline: pipeline.stats,
    gmgn: gmgn ? { pausedForSec: gmgn.pausedForSec, ...gmgn.stats } : "off",
    rpc: rpc.hosts(),
    journal: recorder.stats(),
    trading: positions.summary(),
    wallets: wallets ? wallets.stats : "off",
  }),
  onControl: async (action, actor) => {
    await db`INSERT INTO control_events (actor, action) VALUES (${actor}, ${action})`;
    if (action === "kill" || action === "pause") kill.engage(`${action} oleh ${actor}`);
    if (action === "resume") kill.release();
    if (action === "panic") {
      kill.engage(`panic oleh ${actor}`);
      await positions.panicAll();
    }
    bus.emit({ t: "Control", action, actor });
  },
  onWatchWallet: async (address, active, actor) => {
    if (!wallets) return false;
    await db`INSERT INTO control_events (actor, action, payload) VALUES (${actor}, 'watch_wallet', ${{ address, active }})`;
    await wallets.setWatch(address, active);
    return true;
  },
  onClosePosition: async (id, actor) => {
    await db`INSERT INTO control_events (actor, action, payload) VALUES (${actor}, 'close_position', ${{ id }})`;
    return positions.closeManual(id, "manual");
  },
  positions: () =>
    positions.openPositions.map((p) => ({
      id: p.id,
      mint: p.mint,
      symbol: p.symbol,
      profile: p.profile,
      mode: p.mode,
      sizeSol: p.sizeSol,
      costSol: p.costSol,
      tokensHeld: p.tokensHeld,
      tokensInitial: p.tokensInitial,
      proceedsSol: p.proceedsSol,
      openedAt: p.openedAt,
      lastPrice: p.lastPrice,
      entryPrice: p.state.entryPrice,
      peakPnlPct: p.state.peakPnlPct,
      soldFrac: p.state.soldFrac,
      ladderDone: p.state.ladderDone,
      breakEvenArmed: p.state.breakEvenArmed,
      pnlPct:
        p.lastPrice !== null
          ? ((p.lastPrice * (1 - executor.estimateExitCostPct(p.mint, p.tokensHeld) / 100)) /
              p.state.entryPrice -
              1) *
            100
          : null,
    })),
});
await positions.restore();

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
    await db`INSERT INTO system_events (level, service, kind, data) VALUES ('info', 'core', 'heartbeat', ${{
      lagMs,
      rssMb,
      killed: kill.active,
      activeTokens: tracker.activeTokens,
      pumpportal: pump?.connected ?? null,
      triggers: triggerCounts,
    }})`;
  } catch (err) {
    log.error({ err: String(err) }, "gagal tulis heartbeat");
  }
}, 60_000);

await db`INSERT INTO system_events (level, service, kind, message) VALUES ('info', 'core', 'start', 'core started')`;
log.info({ port: control.port }, "memebot-core siap (Fase 3: paper trading, tanpa uang asli)");

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
  pump?.stop();
  dexFeeds?.stop();
  positions.stop();
  wallets?.stop();
  await pipeline.stop();
  await tracker.stop();
  await recorder.stop();
  try {
    await db`INSERT INTO system_events (level, service, kind, message) VALUES ('info', 'core', 'stop', ${signal})`;
  } finally {
    await db.close();
    process.exit(0);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
