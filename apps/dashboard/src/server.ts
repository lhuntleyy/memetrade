import { createDb } from "@memebot/db";
import { createLogger } from "@memebot/shared";
import index from "./web/index.html";

// Fase 0: shell minimal (health + halaman status). Elysia + React SPA lengkap di Fase 1 (P1-10).
const log = createLogger("dashboard");
const db = createDb(process.env.DATABASE_URL_RO, { max: 3 });
const coreUrl = `http://127.0.0.1:${process.env.CORE_CONTROL_PORT ?? 7071}`;

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
        db`SELECT now() AS now, (SELECT count(*) FROM tokens)::int AS tokens`
          .then(([r]) => ({ ok: true, ...r }))
          .catch((e) => ({ ok: false, error: String(e) })),
      ]);
      return Response.json({ dashboard: { ok: true }, core, database });
    },
    "/api/system/events": async () =>
      Response.json(
        await db`SELECT ts, level, service, kind, message, data FROM system_events ORDER BY ts DESC LIMIT 50`,
      ),
  },
  fetch: () => new Response("not found", { status: 404 }),
});

log.info({ url: server.url.href }, "dashboard siap");
