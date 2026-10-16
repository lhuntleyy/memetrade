// Dashboard Fase 1 — vanilla TS (dibundle Bun). Nama/simbol token = input penyerang → SELALU di-escape.

type Row = Record<string, unknown>;
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
const wib = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const wibFull = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "short",
  timeStyle: "medium",
});
const pct = (v: unknown) => {
  if (v === null || v === undefined || v === "") return `<span class="muted">–</span>`;
  const n = Number(v);
  return `<span class="${n > 0 ? "up" : n < 0 ? "down" : ""}">${n > 0 ? "+" : ""}${n.toFixed(1)}%</span>`;
};
const num = (v: unknown) => (v === null || v === undefined ? `<span class="muted">–</span>` : esc(v));
const short = (mint: string) => `${mint.slice(0, 4)}…${mint.slice(-4)}`;
const getJson = <T = Row[]>(url: string): Promise<T> => fetch(url).then((r) => r.json());

// ---------- tabs ----------
let current = "overview";
for (const b of document.querySelectorAll<HTMLButtonElement>("nav button")) {
  b.onclick = () => {
    current = b.dataset.tab!;
    for (const x of document.querySelectorAll("nav button")) x.classList.toggle("active", x === b);
    for (const s of document.querySelectorAll(".tab"))
      s.classList.toggle("active", s.id === `tab-${current}`);
    void refresh();
  };
}

// ---------- overview ----------
function card(title: string, ok: boolean | null, rows: [string, unknown][]) {
  const cls = ok === null ? "" : ok ? "ok" : "bad";
  const dot = ok === null ? "" : ok ? " ●" : " ○";
  const body = rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  return `<article class="${cls}"><h3>${esc(title)}${dot}</h3>${body}</article>`;
}

async function loadOverview() {
  const { core, counts } = await getJson<{ core: Row & { ok?: boolean }; counts: Row }>("/api/overview");
  const up = core.service === "core";
  $("#mode").textContent = up ? String(core.mode).toUpperCase() : "CORE OFF";
  $("#mode").className = up ? (core.killed ? "bad" : "ok") : "bad";
  $("#health").innerHTML =
    card("Core", up, [
      ["mode", core.mode ?? "–"],
      ["uptime", up ? `${Math.round(Number(core.uptimeSec) / 60)} menit` : "–"],
      ["kill switch", core.killed ? `AKTIF (${core.killReason})` : "off"],
      ["RAM", up ? `${core.rssMb} MB` : "–"],
    ]) +
    card("Database", true, [
      ["token", counts.tokens],
      ["trigger 24 jam", counts.triggers_24h],
      ["path selesai", counts.paths_done],
      ["tick 1 jam", counts.ticks_1h],
    ]);

  const col = (core.collectors ?? {}) as Row;
  const pp = col.pumpportal as Row | string | undefined;
  const tr = (core.tracker ?? {}) as Row;
  const trig = (core.triggers ?? {}) as Record<string, number>;
  $("#core-detail").innerHTML = up
    ? card("PumpPortal", typeof pp === "object" ? Boolean(pp.connected) : null, [
        ["status", typeof pp === "object" ? (pp.connected ? "terhubung" : "putus") : String(pp)],
        ["pesan terakhir", typeof pp === "object" ? `${pp.lastMessageAgoSec} dtk lalu` : "–"],
      ]) +
      card("Tracker", true, [
        ["token aktif", tr.activeTokens],
        ["path aktif", tr.activePaths],
        ["selesai (sesi ini)", tr.completed],
        ["ditolak (penuh)", tr.rejectedFull],
        ["putaran poll", `${tr.pollCycles} (${tr.lastCycleMs} ms)`],
      ]) +
      card(
        "Trigger (sesi ini)",
        null,
        Object.entries(trig).sort((a, b) => b[1] - a[1]),
      )
    : "";

  const events = await getJson("/api/system/events");
  $("#events tbody").innerHTML = events
    .map(
      (e) =>
        `<tr><td>${wibFull.format(new Date(String(e.ts)))}</td><td>${esc(e.service)}</td><td>${esc(e.kind)}</td><td>${esc(e.message)}</td></tr>`,
    )
    .join("");
}

// ---------- live feed ----------
function feedRow(r: Row) {
  const mint = String(r.mint);
  const label = r.symbol ? `<b>${esc(r.symbol)}</b> <span class="muted">${esc(r.name ?? "")}</span>` : "";
  let status = r.backlog ? `<span class="tag">backlog</span>` : "";
  if (!r.backlog) {
    if (r.completed_at)
      status = r.rugged ? `<span class="tag bad">rug</span>` : `<span class="tag">selesai</span>`;
    else if (r.entry_price_ref) status = `<span class="tag ok">tracking</span>`;
    else status = `<span class="tag">menunggu harga</span>`;
  }
  return `<tr>
    <td>${wib.format(new Date(String(r.ts)))}</td>
    <td>${esc(r.source)}.${esc(r.kind)}</td>
    <td>${label} <a href="https://dexscreener.com/solana/${encodeURIComponent(mint)}" target="_blank" rel="noopener noreferrer"><code>${esc(short(mint))}</code></a></td>
    <td>${pct(r.max_ret)}</td><td>${pct(r.min_ret)}</td><td>${pct(r.ret_5m)}</td><td>${status}</td></tr>`;
}

async function loadFeed() {
  const rows = await getJson("/api/feed/recent?limit=150");
  $("#feed tbody").innerHTML = rows.map(feedRow).join("");
}

// ---------- trigger lab ----------
async function loadLab() {
  const hours = $<HTMLSelectElement>("#lab-hours").value;
  const [sources, heat, dist] = await Promise.all([
    getJson(`/api/lab/sources?hours=${hours}`),
    getJson(`/api/lab/heatmap?hours=${hours}`),
    getJson(`/api/lab/distribution?hours=${hours}`),
  ]);

  $("#lab-sources tbody").innerHTML = sources.length
    ? sources
        .map(
          (s) => `<tr><td><b>${esc(s.source)}</b></td><td>${num(s.n_total)}</td><td>${num(s.n_running)}</td>
        <td>${num(s.n_done)}</td><td>${num(s.n_no_price)}</td><td>${num(s.hit20 && `${s.hit20}%`)}</td>
        <td>${num(s.hit50 && `${s.hit50}%`)}</td><td>${num(s.hit100 && `${s.hit100}%`)}</td><td>${num(s.rug_rate && `${s.rug_rate}%`)}</td>
        <td>${pct(s.med_max_ret)}</td><td>${num(s.med_min_to_peak)}</td><td>${pct(s.med_ret_5m)}</td>
        <td>${pct(s.med_ret_15m)}</td><td>${pct(s.med_ret_60m)}</td><td>${num(s.med_ref_delay_sec !== null ? `${s.med_ref_delay_sec} dtk` : null)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="15" class="muted">Belum ada data — path dihitung selesai setelah durasi tracking (default 90 menit).</td></tr>`;

  // distribusi: tabel sumber × bucket
  const buckets = ["<0", "0–20", "20–50", "50–100", "100–300", "≥300"];
  const bySrc = new Map<string, Record<string, number>>();
  for (const d of dist) {
    const m = bySrc.get(String(d.source)) ?? {};
    m[String(d.bucket)] = Number(d.n);
    bySrc.set(String(d.source), m);
  }
  $("#lab-dist").innerHTML = bySrc.size
    ? `<table><thead><tr><th>Sumber</th>${buckets.map((b) => `<th>${b}%</th>`).join("")}</tr></thead><tbody>${[
        ...bySrc,
      ]
        .map(([src, m]) => {
          const total = Object.values(m).reduce((a, b) => a + b, 0);
          return `<tr><td><b>${esc(src)}</b></td>${buckets
            .map((b) => {
              const share = total ? ((m[b] ?? 0) / total) * 100 : 0;
              return `<td><div class="bar" style="--w:${share.toFixed(0)}%"></div>${m[b] ?? 0} <span class="muted">(${share.toFixed(0)}%)</span></td>`;
            })
            .join("")}</tr>`;
        })
        .join("")}</tbody></table>`
    : `<p class="muted">Belum ada data.</p>`;

  // heatmap: sumber × jam
  const srcs = [...new Set(heat.map((h) => String(h.source)))];
  const cell = new Map(heat.map((h) => [`${h.source}|${h.hour_wib}`, h]));
  $("#lab-heatmap").innerHTML = srcs.length
    ? `<table class="heat"><thead><tr><th>Sumber</th>${Array.from({ length: 24 }, (_, h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${srcs
        .map(
          (s) =>
            `<tr><td><b>${esc(s)}</b></td>${Array.from({ length: 24 }, (_, h) => {
              const c = cell.get(`${s}|${h}`);
              if (!c) return `<td class="muted">·</td>`;
              const v = Number(c.hit50);
              return `<td title="n=${c.n}, rug ${c.rug_rate}%" style="--a:${Math.min(1, v / 50).toFixed(2)}">${v.toFixed(0)}</td>`;
            }).join("")}</tr>`,
        )
        .join(
          "",
        )}</tbody></table><p class="muted">Angka = % path yang menyentuh +50%. Hover untuk jumlah sampel & rug rate.</p>`
    : `<p class="muted">Belum ada data.</p>`;
}
$<HTMLSelectElement>("#lab-hours").onchange = () => void loadLab();

// ---------- realtime ----------
function connectWs() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => ($("#ws-dot").textContent = "●");
  ws.onclose = () => {
    $("#ws-dot").textContent = "○";
    setTimeout(connectWs, 3000);
  };
  ws.onmessage = (ev) => {
    const e = JSON.parse(String(ev.data));
    if (e.t === "TokenTriggered" && current === "feed") {
      const tbody = $("#feed tbody");
      tbody.insertAdjacentHTML(
        "afterbegin",
        feedRow({
          ts: e.ts,
          mint: e.mint,
          source: e.source,
          kind: e.kind,
          symbol: e.meta?.symbol,
          name: e.meta?.name,
          backlog: e.payload?.backlog,
        }),
      );
      while (tbody.children.length > 300) tbody.lastElementChild?.remove();
    }
  };
}

async function refresh() {
  try {
    if (current === "overview") await loadOverview();
    else if (current === "feed") await loadFeed();
    else await loadLab();
  } catch (err) {
    console.error(err);
  }
}

connectWs();
void refresh();
setInterval(() => void refresh(), 10_000);
