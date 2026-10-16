import type { EventBus, Logger, SourcesConfig } from "@memebot/shared";
import { backoffMs, toNum } from "@memebot/shared";
import { pumpCurvePriceSol } from "@memebot/solana";

/** Bentuk event PumpPortal yang kita pakai (dicek dari stream asli 2026-10-17). */
interface PumpCreate {
  txType: "create";
  signature: string;
  mint: string;
  traderPublicKey: string;
  initialBuy?: number;
  solAmount?: number;
  bondingCurveKey?: string;
  vTokensInBondingCurve?: number;
  vSolInBondingCurve?: number;
  marketCapSol?: number;
  name?: string;
  symbol?: string;
  uri?: string;
  pool?: string;
  is_mayhem_mode?: boolean;
}
interface PumpMigrate {
  txType: "migrate";
  signature: string;
  mint: string;
  pool?: string;
}

/** Normalisasi pesan PumpPortal → argumen TokenTriggered (null kalau bukan event yang kita pakai). */
export function normalizePumpPortal(msg: unknown, now = Date.now()) {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Partial<PumpCreate | PumpMigrate>;
  if (typeof m.mint !== "string" || typeof m.signature !== "string") return null;

  if (m.txType === "create") {
    const c = m as PumpCreate;
    const vSol = toNum(c.vSolInBondingCurve);
    const vTok = toNum(c.vTokensInBondingCurve);
    return {
      mint: c.mint,
      kind: "new_token",
      ts: now,
      payload: c,
      meta: {
        name: c.name,
        symbol: c.symbol,
        creator: c.traderPublicKey,
        launchpad: c.pool ?? "pump",
        poolAddress: c.bondingCurveKey,
        poolKind: "pump_curve",
        priceSol: vSol && vTok ? pumpCurvePriceSol(vSol, vTok) : undefined,
        mcapSol: toNum(c.marketCapSol) ?? undefined,
      },
    };
  }
  if (m.txType === "migrate") {
    return {
      mint: m.mint,
      kind: "migration",
      ts: now,
      payload: m,
      meta: { launchpad: "pump", poolKind: m.pool ?? "pump-amm" },
    };
  }
  return null;
}

/**
 * Satu koneksi WebSocket ke PumpPortal (WAJIB satu — buka banyak koneksi = ban 1 jam).
 * Reconnect dengan backoff; kalau sunyi > staleMs, koneksi dianggap mati dan dibuka ulang.
 */
export function startPumpPortal(
  cfg: SourcesConfig["pumpportal"],
  bus: EventBus,
  log: Logger,
  staleMs = 120_000,
) {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let lastMsg = Date.now();
  let stopped = false;
  let reconnectTimer: Timer | undefined;

  const connect = () => {
    if (stopped) return;
    const url = process.env.PUMPPORTAL_API_KEY
      ? `${cfg.ws_url}?api-key=${process.env.PUMPPORTAL_API_KEY}`
      : cfg.ws_url;
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      lastMsg = Date.now();
      log.info("pumpportal terhubung");
      if (cfg.new_token) ws?.send(JSON.stringify({ method: "subscribeNewToken" }));
      if (cfg.migration) ws?.send(JSON.stringify({ method: "subscribeMigration" }));
    };
    ws.onmessage = (ev) => {
      lastMsg = Date.now();
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const n = normalizePumpPortal(data);
      if (n) bus.emit({ t: "TokenTriggered", source: "pumpportal", ...n });
    };
    ws.onerror = () => log.warn("pumpportal error");
    ws.onclose = (ev) => {
      ws = null;
      if (stopped) return;
      const wait = backoffMs(attempt++, 2000, 60_000);
      log.warn({ code: ev.code, waitMs: wait }, "pumpportal terputus, reconnect");
      reconnectTimer = setTimeout(connect, wait);
    };
  };

  const watchdog = setInterval(() => {
    if (ws && Date.now() - lastMsg > staleMs) {
      log.warn({ silentMs: Date.now() - lastMsg }, "pumpportal sunyi terlalu lama, tutup & sambung ulang");
      ws.close();
    }
  }, 15_000);

  connect();
  return {
    get connected() {
      return ws?.readyState === WebSocket.OPEN;
    },
    get lastMessageAt() {
      return lastMsg;
    },
    stop() {
      stopped = true;
      clearInterval(watchdog);
      clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
