import { createDb } from "@memebot/db";
import { createLogger, loadConfig } from "@memebot/shared";
import { loadReplayData, runReplay, sweepTpSl } from "../../core/src/research/replay.ts";
import { createAuth, LOGIN_PAGE } from "./auth.ts";
import {
  closedPositions,
  counts,
  equityCurve,
  exitReasons,
  filterEffectiveness,
  labDistribution,
  labHeatmap,
  labSources,
  pipelineFunnel,
  recentTriggers,
  rejectReasons,
  smartSignals,
  tokenDetail,
  tradingKpi,
  walletDetail,
  walletLeaderboard,
  watchSummary,
} from "./queries.ts";
import index from "./web/index.html";

// Dashboard: bind 127.0.0.1, akses luar via `tailscale serve`; semua /api & /ws butuh login.
const log = createLogger("dashboard");
const db = createDb(process.env.DATABASE_URL_RO, { max: 3 });
const corePort = process.env.CORE_CONTROL_PORT ?? 7071;
const coreUrl = `http://127.0.0.1:${corePort}`;
const secret = process.env.CONTROL_SECRET ?? "";

const auth = createAuth({
  passwordHash: process.env.DASHBOARD_PASSWORD_HASH,
  sessionKey: `${secret}:dashboard-session`,
  secureCookie: process.env.DASHBOARD_SECURE_COOKIE === "1",
});
if (!auth.enabled)
  log.warn("DASHBOARD_PASSWORD_HASH belum di-set — dashboard TANPA login (hanya aman di 127.0.0.1)");

type Handler = (req: Request) => Response | Promise<Response>;
/** Bungkus handler API: 401 kalau belum login (app.ts lalu redirect ke /login). */
const guard =
  (h: Handler): Handler =>
  async (req) =>
    (await auth.isAuthed(req)) ? h(req) : Response.json({ error: "unauthorized" }, { status: 401 });

const clampInt = (v: string | null, def: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.parseInt(v ?? "", 10) || def));

const coreStatus = () =>
  fetch(`${coreUrl}/status`, {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(1500),
  })
    .then((r) => (r.ok ? r.json() : { ok: false, http: r.status }))
    .catch(() => ({ ok: false }));

/** Teruskan perintah ke control API core; actor = "dashboard:<ip>" (tercatat di control_events). */
function coreCommand(path: string, req: Request) {
  return fetch(`${coreUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "x-actor": `dashboard:${clientIp(req)}` },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => new Response(JSON.stringify({ error: "core tidak bisa dihubungi" }), { status: 502 }));
}

/** IP klien: dari header tailscale serve kalau ada, selain itu alamat socket. */
let clientIp: (req: Request) => string = () => "unknown";

const server = Bun.serve({
  hostname: process.env.DASHBOARD_HOST ?? "127.0.0.1",
  port: Number(process.env.DASHBOARD_PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": index,
    "/api/health": guard(async () => {
      const [core, database] = await Promise.all([
        fetch(`${coreUrl}/health`, { signal: AbortSignal.timeout(1500) })
          .then((r) => r.json())
          .catch(() => ({ ok: false })),
        db`SELECT now() AS now`.then(() => ({ ok: true })).catch((e) => ({ ok: false, error: String(e) })),
      ]);
      return Response.json({ dashboard: { ok: true }, core, database });
    }),
    "/api/overview": guard(async () => {
      const [core, [c]] = await Promise.all([coreStatus(), counts(db)]);
      return Response.json({ core, counts: c });
    }),
    "/api/feed/recent": guard(async (req) => {
      const limit = clampInt(new URL(req.url).searchParams.get("limit"), 100, 1, 500);
      return Response.json(await recentTriggers(db, limit));
    }),
    "/api/lab/sources": guard(async (req) => {
      const hours = clampInt(new URL(req.url).searchParams.get("hours"), 24, 1, 24 * 30);
      return Response.json(await labSources(db, hours));
    }),
    "/api/lab/heatmap": guard(async (req) => {
      const hours = clampInt(new URL(req.url).searchParams.get("hours"), 168, 1, 24 * 30);
      return Response.json(await labHeatmap(db, hours));
    }),
    "/api/lab/distribution": guard(async (req) => {
      const hours = clampInt(new URL(req.url).searchParams.get("hours"), 24, 1, 24 * 30);
      return Response.json(await labDistribution(db, hours));
    }),
    "/api/pipeline": guard(async (req) => {
      const hours = clampInt(new URL(req.url).searchParams.get("hours"), 24, 1, 24 * 30);
      const [funnel, reasons, effectiveness] = await Promise.all([
        pipelineFunnel(db, hours),
        rejectReasons(db, hours),
        filterEffectiveness(db, hours),
      ]);
      return Response.json({ funnel, reasons, effectiveness });
    }),
    "/api/token/:mint": guard(async (req) => {
      const mint = (req as Request & { params: { mint: string } }).params.mint;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))
        return Response.json({ error: "mint tidak valid" }, { status: 400 });
      return Response.json(await tokenDetail(db, mint));
    }),
    "/api/positions": guard(async () => {
      const r = await fetch(`${coreUrl}/positions`, {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(2000),
      }).catch(() => null);
      return Response.json(r?.ok ? await r.json() : [], { status: r?.ok ? 200 : 502 });
    }),
    "/api/positions/:id/close": {
      POST: guard(async (req) => {
        const id = (req as Request & { params: { id: string } }).params.id;
        if (!/^\d+$/.test(id)) return Response.json({ error: "id tidak valid" }, { status: 400 });
        const r = await coreCommand(`/positions/${id}/close`, req);
        return Response.json(await r.json().catch(() => ({})), { status: r.status });
      }),
    },
    "/api/control/:action": {
      POST: guard(async (req) => {
        const action = (req as Request & { params: { action: string } }).params.action;
        if (!["pause", "resume", "kill", "panic"].includes(action))
          return Response.json({ error: "aksi tidak dikenal" }, { status: 400 });
        const r = await coreCommand(`/control/${action}`, req);
        return Response.json(await r.json().catch(() => ({})), { status: r.status });
      }),
    },
    "/api/trades": guard(async (req) => {
      const u = new URL(req.url);
      const mode = u.searchParams.get("mode") === "live" ? "live" : "paper";
      const limit = clampInt(u.searchParams.get("limit"), 200, 1, 1000);
      const [[kpi], reasons, equity, trades] = await Promise.all([
        tradingKpi(db, mode),
        exitReasons(db, mode),
        equityCurve(db, mode),
        closedPositions(db, limit),
      ]);
      return Response.json({ kpi, reasons, equity, trades });
    }),
    "/api/wallets": guard(async (req) => {
      const u = new URL(req.url);
      const hours = clampInt(u.searchParams.get("hours"), 24, 1, 24 * 30);
      const minTier = clampInt(u.searchParams.get("tier"), 0, 0, 1_000_000);
      const kindParam = u.searchParams.get("kind") ?? "all";
      const kind = ["all", "top_holder", "big_buyer"].includes(kindParam) ? kindParam : "all";
      return Response.json(await walletLeaderboard(db, hours, minTier, kind, 200));
    }),
    "/api/smart-signals": guard(async (req) => {
      const hours = clampInt(new URL(req.url).searchParams.get("hours"), 24, 1, 24 * 30);
      const [signals, [summary]] = await Promise.all([smartSignals(db, hours), watchSummary(db)]);
      return Response.json({ signals, summary });
    }),
    "/api/wallets/:address": guard(async (req) => {
      const a = (req as Request & { params: { address: string } }).params.address;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))
        return Response.json({ error: "alamat tidak valid" }, { status: 400 });
      return Response.json(await walletDetail(db, a));
    }),
    "/api/wallets/:address/:action": {
      POST: guard(async (req) => {
        const { address, action } = (req as Request & { params: { address: string; action: string } }).params;
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || !["watch", "unwatch"].includes(action))
          return Response.json({ error: "permintaan tidak valid" }, { status: 400 });
        const r = await coreCommand(`/wallets/${address}/${action}`, req);
        return Response.json(await r.json().catch(() => ({})), { status: r.status });
      }),
    },
    "/api/backtest": guard(async (req) => {
      const u = new URL(req.url);
      const strategy = (await loadConfig("strategy")).data;
      const profile = u.searchParams.get("profile") ?? "all";
      const prof = profile === "all" ? Object.values(strategy.profiles)[0] : strategy.profiles[profile];
      if (!prof) return Response.json({ error: "profile tidak ada" }, { status: 400 });
      const exit = strategy.exits[prof.exits.ref.replace(/^exits\./, "")];
      if (!exit) return Response.json({ error: "exit config tidak ada" }, { status: 400 });
      const list = (k: string, def: number[]) => {
        const v = (u.searchParams.get(k) ?? "")
          .split(",")
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > 0 && n <= 1000)
          .slice(0, 8);
        return v.length ? v : def;
      };
      const tps = list("tps", [15, 20, 25, 30, 40, 50]);
      const sls = list("sls", [10, 15, 20, 30]);
      const opts = {
        latencySec: clampInt(u.searchParams.get("latency"), 1, 0, 30),
        entryCostPct: Math.min(20, Math.max(0, Number(u.searchParams.get("entry_cost") ?? 1.5) || 0)),
        exitCostPct: Math.min(20, Math.max(0, Number(u.searchParams.get("exit_cost") ?? 1.5) || 0)),
      };
      const data = await loadReplayData(db, {
        profile,
        hours: clampInt(u.searchParams.get("hours"), 24, 1, 24 * 30),
        universe: u.searchParams.get("universe") === "evaluated" ? "evaluated" : "passed",
        horizonSec: exit.max_hold_sec + 60,
        maxCandidates: 2000,
      });
      const current = runReplay(data, exit, opts);
      const cells = sweepTpSl(data, exit, tps, sls, opts);
      return Response.json({
        profile,
        exitRef: prof.exits.ref,
        options: opts,
        candidates: data.candidates.length,
        current: current.metrics,
        trades: current.trades.slice(0, 200),
        tps,
        sls,
        cells: cells.map((c) => ({ tp: c.tp, sl: c.sl, ...c.m })),
      });
    }),
    "/api/system/events": guard(async () =>
      Response.json(
        await db`SELECT ts, level, service, kind, message, data FROM system_events
                 WHERE kind <> 'heartbeat' ORDER BY ts DESC LIMIT 50`,
      ),
    ),
    "/login": {
      GET: (req) =>
        new Response(LOGIN_PAGE(new URL(req.url).searchParams.has("err")), {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      POST: (req) => auth.login(req, clientIp(req)),
    },
    "/logout": { POST: () => auth.logout() },
    "/ws": async (req, srv) => {
      if (!(await auth.isAuthed(req))) return new Response("unauthorized", { status: 401 });
      return srv.upgrade(req) ? undefined : new Response("upgrade gagal", { status: 400 });
    },
  },
  websocket: {
    open(ws) {
      ws.subscribe("feed");
    },
    message() {},
  },
  fetch: () => new Response("not found", { status: 404 }),
});

// Header forwarded hanya dipercaya kalau dashboard di belakang reverse proxy lokal (Caddy) —
// selain itu bisa dipalsukan klien untuk mengakali throttle login.
const trustProxy = process.env.DASHBOARD_TRUST_PROXY === "1";
clientIp = (req) => {
  const sock = server.requestIP(req)?.address ?? "unknown";
  const fromLocalProxy = sock === "127.0.0.1" || sock === "::1" || sock === "::ffff:127.0.0.1";
  if (trustProxy && fromLocalProxy) {
    // Caddy menulis IP klien asli sebagai entri terakhir X-Forwarded-For
    const xff = req.headers.get("x-forwarded-for")?.split(",").pop()?.trim();
    if (xff) return xff;
  }
  return sock;
};

// ---- relay event dari core → browser (hanya event ringan) ----
const RELAY = new Set(["TokenTriggered", "Heartbeat", "Control", "CircuitBreaker", "Position"]);
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
