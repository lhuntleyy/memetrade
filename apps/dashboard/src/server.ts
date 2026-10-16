import { createDb } from "@memebot/db";
import { createLogger } from "@memebot/shared";
import { counts, labDistribution, labHeatmap, labSources, recentTriggers } from "./queries.ts";
import index from "./web/index.html";

// Fase 1: Overview, Live Feed, Trigger Lab. Login & akses luar (Tailscale) menyusul.
const log = createLogger("dashboard");
const db = createDb(process.env.DATABASE_URL_RO, { max: 3 });
const corePort = process.env.CORE_CONTROL_PORT ?? 7071;
const coreUrl = `http://127.0.0.1:${corePort}`;
const secret = process.env.CONTROL_SECRET ?? "";

const clampInt = (v: string | null, def: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.parseInt(v ?? "", 10) || def));

const coreStatus = () =>
  fetch(`${coreUrl}/status`, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(1500),
  })
    .then((r) => (r.ok ? r.json() : { ok: false, http: r.status }))
    .catch(() => ({ ok: false }));

const server = Bun.serve({
  hostname: process.env.DASHBOARD_HOST ?? "127.0.0.1",
  port: Number(process.env.DASHBOARD_PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/api/health": async () => {
      const [core, database] = await Promise.all([
        fetch(`${coreUrl}/health`, { signal: AbortSignal.timeout(1500) })
          .then((r) => r.json())
          .catch(() => ({ ok: false })),
        db`SELECT now() AS now`.then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) })),
      ]);
      return Response.json({ dashboard: { ok: true }, core, database });
    },
    "/api/overview": async () => {
      const [core, [c]] = await Promise.all([coreStatus(), counts(db)]);
      return Response.json({ core, counts: c });
    },
    "/api/feed/recent": async (req) => {
      const limit = clampInt(new URL(req.url).searchParams.get("limit"), 100, 1, 500);
      return Response.json(await recentTriggers(db, limit));
    },
    "/api/lab/sources": async (req) => {
      const hours = clampInt(new URL(req.url).searchParams.get("hours"), 24, 1, 24 * 30);
      return Response.json(await labSources(db, hours));
    },
    "/api/lab/heatmap": async (req) => {
      const hours = clampInt(new URL(req.url).searchParams.get("hours"), 168, 1, 24 * 30);
      return Response.json(await labHeatmap(db, hours));
    },
    "/api/lab/distribution": async (req) => {
      const hours = clampInt(new URL(req.url).searchParams.get("hours"), 24, 1, 24 * 30);
      return Response.json(await labDistribution(db, hours));
    },
    "/api/system/events": async () =>
      Response.json(
        await db`SELECT ts, level, service, kind, message, data FROM system_events
                 WHERE kind <> 'heartbeat' ORDER BY ts DESC LIMIT 50`,
      ),
    "/ws": (req, srv) => (srv.upgrade(req) ? undefined : new Response("upgrade gagal", { status: 400 })),
  },
  websocket: {
    open(ws) {
      ws.subscribe("feed");
    },
    message() {},
  },
  fetch: () => new Response("not found", { status: 404 }),
});

// ---- relay event dari core → browser (hanya event ringan) ----
const RELAY = new Set(["TokenTriggered", "Heartbeat", "Control", "CircuitBreaker"]);
let attempt = 0;
function connectCore() {
  const ws = new WebSocket(`ws://127.0.0.1:${corePort}/events?secret=${encodeURIComponent(secret)}`);
  ws.onopen = () => {
    attempt = 0;
    log.info("terhubung ke stream event core");
  };
  ws.onmessage = (ev) => {
    const raw = String(ev.data);
    const t = raw.slice(6, 40).match(/^([A-Za-z]+)"/)?.[1]; // payload diawali {"t":"Nama"
    if (!t || !RELAY.has(t)) return;
    if (t === "TokenTriggered") {
      // buang payload mentah (bisa besar) sebelum dikirim ke browser
      const e = JSON.parse(raw);
      server.publish("feed", JSON.stringify({ ...e, payload: { backlog: e.payload?.backlog ?? false } }));
    } else server.publish("feed", raw);
  };
  ws.onclose = () => setTimeout(connectCore, Math.min(30_000, 1000 * 2 ** attempt++));
}
connectCore();

log.info({ url: server.url.href }, "dashboard siap");
