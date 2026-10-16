import type { EventBus, Logger } from "@memebot/shared";

export type ControlAction = "pause" | "resume" | "kill" | "panic" | "reload";
const ACTIONS = new Set<ControlAction>(["pause", "resume", "kill", "panic", "reload"]);

interface Options {
  port: number;
  secret: string | undefined;
  bus: EventBus;
  log: Logger;
  status: () => Record<string, unknown>;
  onControl: (action: ControlAction, actor: string) => Promise<void>;
}

/**
 * API kontrol lokal (127.0.0.1 saja). Dipakai dashboard:
 *  GET  /health              → status ringkas (tanpa auth, untuk systemd/monitoring)
 *  GET  /status              → status lengkap (auth)
 *  POST /control/:action     → pause|resume|kill|panic|reload (auth, header x-actor)
 *  WS   /events              → stream semua event bus (auth via ?secret=)
 */
export function startControlServer(o: Options) {
  if (!o.secret || o.secret.length < 32) throw new Error("CONTROL_SECRET wajib di-set (>= 32 karakter)");
  const authed = (req: Request, url: URL) =>
    req.headers.get("authorization") === `Bearer ${o.secret}` || url.searchParams.get("secret") === o.secret;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: o.port,
    async fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/health")
        return Response.json({ ok: true, ...pick(o.status(), ["service", "uptimeSec", "mode", "killed"]) });
      if (!authed(req, url)) return new Response("unauthorized", { status: 401 });

      if (url.pathname === "/events") {
        return srv.upgrade(req) ? undefined : new Response("upgrade gagal", { status: 400 });
      }
      if (url.pathname === "/status" && req.method === "GET") return Response.json(o.status());

      const m = url.pathname.match(/^\/control\/([a-z]+)$/);
      if (m && req.method === "POST") {
        const action = m[1] as ControlAction;
        if (!ACTIONS.has(action)) return new Response("aksi tidak dikenal", { status: 400 });
        const actor = req.headers.get("x-actor") ?? "unknown";
        o.log.warn({ action, actor }, "perintah kontrol");
        await o.onControl(action, actor);
        return Response.json({ ok: true, action, status: o.status() });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.subscribe("events");
      },
      message() {},
    },
  });

  const off = o.bus.onAny((e) => server.publish("events", JSON.stringify(e)));
  return {
    port: server.port,
    stop() {
      off();
      server.stop(true);
    },
  };
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
