type Health = {
  dashboard: { ok: boolean };
  core: Record<string, unknown> & { ok: boolean };
  database: Record<string, unknown> & { ok: boolean };
};
type SysEvent = { ts: string; service: string; kind: string; message: string | null };

const wib = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "short",
  timeStyle: "medium",
});

function card(title: string, ok: boolean, rows: Record<string, unknown>) {
  const body = Object.entries(rows)
    .filter(([k]) => k !== "ok")
    .map(([k, v]) => `<div><span>${k}</span><b>${String(v)}</b></div>`)
    .join("");
  return `<article class="${ok ? "ok" : "bad"}"><h3>${title} ${ok ? "●" : "○"}</h3>${body}</article>`;
}

async function refresh() {
  const h: Health = await fetch("/api/health").then((r) => r.json());
  document.querySelector("#health")!.innerHTML =
    card("Core", h.core.ok, h.core) +
    card("Database", h.database.ok, h.database) +
    card("Dashboard", true, {});

  const events: SysEvent[] = await fetch("/api/system/events").then((r) => r.json());
  document.querySelector("#events tbody")!.innerHTML = events
    .map(
      (e) =>
        `<tr><td>${wib.format(new Date(e.ts))}</td><td>${e.service}</td><td>${e.kind}</td><td>${e.message ?? ""}</td></tr>`,
    )
    .join("");
}

refresh();
setInterval(refresh, 5000);
