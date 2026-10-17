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
const getJson = async <T = Row[]>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (r.status === 401) {
    location.href = "/login";
    throw new Error("belum login");
  }
  return r.json();
};

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
    <td>${label} <a href="#" data-mint="${esc(mint)}"><code>${esc(short(mint))}</code></a></td>
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

// ---------- pipeline ----------
async function loadPipeline() {
  const hours = $<HTMLSelectElement>("#pipe-hours").value;
  const { funnel, reasons, effectiveness } = await getJson<{
    funnel: Row[];
    reasons: Row[];
    effectiveness: Row[];
  }>(`/api/pipeline?hours=${hours}`);
  const empty = (cols: number) => `<tr><td colspan="${cols}" class="muted">Belum ada data.</td></tr>`;
  const share = (a: unknown, b: unknown) =>
    Number(b) ? ` <span class="muted">(${((Number(a) / Number(b)) * 100).toFixed(0)}%)</span>` : "";
  $("#pipe-funnel tbody").innerHTML = funnel.length
    ? funnel
        .map(
          (f) => `<tr><td><b>${esc(f.profile)}</b></td><td>${num(f.evaluated)}</td>
        <td>${num(f.security_pass)}${share(f.security_pass, f.evaluated)}</td>
        <td>${num(f.filter_pass)}${share(f.filter_pass, f.evaluated)}</td>
        <td>${num(f.signals)}${share(f.signals, f.evaluated)}</td></tr>`,
        )
        .join("")
    : empty(5);
  $("#pipe-reasons tbody").innerHTML = reasons.length
    ? reasons
        .map(
          (r) =>
            `<tr><td>${esc(r.profile)}</td><td>${esc(r.stage)}</td><td><code>${esc(r.reason)}</code></td><td>${num(r.n)}</td></tr>`,
        )
        .join("")
    : empty(4);
  $("#pipe-eff tbody").innerHTML = effectiveness.length
    ? effectiveness
        .map((e) => {
          const group = String(e.rule).startsWith("(");
          return `<tr${group ? ' class="group"' : ""}><td>${esc(e.profile)}</td><td>${group ? `<b>${esc(e.rule)}</b>` : `<code>${esc(e.rule)}</code>`}</td>
          <td>${num(e.n)}</td><td>${num(e.hit50 !== null ? `${e.hit50}%` : null)}</td><td>${num(e.hit100 !== null ? `${e.hit100}%` : null)}</td>
          <td>${num(e.rug_rate !== null ? `${e.rug_rate}%` : null)}</td><td>${pct(e.med_max_ret)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">Belum ada path selesai untuk token yang dievaluasi (tunggu ±90 menit).</td></tr>`;
}
$<HTMLSelectElement>("#pipe-hours").onchange = () => void loadPipeline();

// ---------- token explorer ----------
function sparkline(points: number[], w = 600, h = 80) {
  if (points.length < 2) return `<p class="muted">Belum ada tick harga.</p>`;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((v, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${d}" /></svg>`;
}

async function loadToken(mint: string) {
  $<HTMLInputElement>("#token-mint").value = mint;
  const t = await getJson<{
    token: Row | null;
    triggers: Row[];
    decisions: Row[];
    security: Row | null;
    paths: Row[];
    ticks: Row[];
  }>(`/api/token/${encodeURIComponent(mint)}`);
  if (!t.token) {
    $("#token-body").innerHTML = `<p class="muted">Token belum pernah tercatat.</p>`;
    return;
  }
  const k = t.token;
  const sec = t.security;
  const ext = (sec?.extensions ?? {}) as { list?: string[]; warnings?: string[]; program?: string };
  $("#token-body").innerHTML = `
    <div class="grid">
      ${card(`${k.symbol ?? "?"} — ${k.name ?? ""}`, null, [
        ["mint", short(String(k.mint))],
        ["launchpad", k.launchpad ?? "–"],
        ["creator", k.creator ? short(String(k.creator)) : "–"],
        ["pertama terlihat", wibFull.format(new Date(String(k.first_seen_at)))],
        ["sumber pertama", k.first_source ?? "–"],
        ["migrasi", k.migrated_at ? wibFull.format(new Date(String(k.migrated_at))) : "–"],
      ])}
      ${card("Security", sec ? sec.verdict === "pass" : null, [
        ["hasil", sec ? String(sec.verdict).toUpperCase() : "belum dicek"],
        ["alasan", sec && (sec.reasons as string[]).length ? (sec.reasons as string[]).join(", ") : "–"],
        ["peringatan", ext.warnings?.length ? ext.warnings.join(", ") : "–"],
        ["program", ext.program ?? "–"],
        ["extension", ext.list?.length ? ext.list.join(", ") : "–"],
      ])}
    </div>
    <p><a href="https://dexscreener.com/solana/${encodeURIComponent(String(k.mint))}" target="_blank" rel="noopener noreferrer">DexScreener</a> ·
       <a href="https://solscan.io/token/${encodeURIComponent(String(k.mint))}" target="_blank" rel="noopener noreferrer">Solscan</a> ·
       <a href="https://gmgn.ai/sol/token/${encodeURIComponent(String(k.mint))}" target="_blank" rel="noopener noreferrer">GMGN</a></p>
    <h2>Harga (3 jam terakhir, SOL)</h2>
    ${sparkline(t.ticks.map((x) => Number(x.price_sol)))}
    <h2>Jalur harga per trigger</h2>
    <div class="scroll"><table><thead><tr><th>Sumber</th><th>t0</th><th>Delay harga</th><th>1m</th><th>5m</th><th>15m</th><th>60m</th><th>Max</th><th>Min</th><th>Rug</th></tr></thead><tbody>
    ${t.paths
      .map(
        (
          p,
        ) => `<tr><td>${esc(p.source)}</td><td>${wib.format(new Date(String(p.t0)))}</td><td>${num(p.ref_delay_sec !== null ? `${p.ref_delay_sec} dtk` : null)}</td>
      <td>${pct(p.ret_1m)}</td><td>${pct(p.ret_5m)}</td><td>${pct(p.ret_15m)}</td><td>${pct(p.ret_60m)}</td><td>${pct(p.max_ret)}</td><td>${pct(p.min_ret)}</td>
      <td>${p.rugged === null ? "–" : p.rugged ? '<span class="tag bad">ya</span>' : "tidak"}</td></tr>`,
      )
      .join("")}</tbody></table></div>
    <h2>Keputusan pipeline</h2>
    <div class="scroll"><table><thead><tr><th>Waktu</th><th>Profile</th><th>Tahap</th><th>Hasil</th><th>Alasan</th></tr></thead><tbody>
    ${
      t.decisions
        .map(
          (
            d,
          ) => `<tr><td>${wib.format(new Date(String(d.ts)))}</td><td>${esc(d.profile)}</td><td>${esc(d.stage)}</td>
      <td>${d.passed ? '<span class="tag ok">lolos</span>' : '<span class="tag bad">gagal</span>'}</td>
      <td>${(d.failed_rules as string[]).map((r) => `<code>${esc(r)}</code>`).join(" ")}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="5" class="muted">Token ini belum dievaluasi profile mana pun.</td></tr>'
    }</tbody></table></div>
    <h2>Fitur saat evaluasi terakhir</h2>
    <pre class="features">${esc(JSON.stringify(t.decisions.find((d) => d.stage === "filter")?.features ?? {}, null, 2))}</pre>
    <h2>Trigger</h2>
    <p>${t.triggers.map((x) => `${wib.format(new Date(String(x.ts)))} <code>${esc(x.source)}.${esc(x.kind)}</code>`).join(" · ")}</p>`;
}

function openToken(mint: string) {
  current = "token";
  for (const x of document.querySelectorAll<HTMLButtonElement>("nav button"))
    x.classList.toggle("active", x.dataset.tab === "token");
  for (const s of document.querySelectorAll(".tab")) s.classList.toggle("active", s.id === "tab-token");
  void loadToken(mint);
}

$("#token-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const mint = $<HTMLInputElement>("#token-mint").value.trim();
  if (mint) openToken(mint);
});
document.addEventListener("click", (ev) => {
  const a = (ev.target as HTMLElement).closest<HTMLElement>("a[data-mint]");
  if (!a) return;
  ev.preventDefault();
  openToken(a.dataset.mint!);
});

// ---------- posisi & kontrol ----------
const dur = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}j ${m % 60}m`;
};
const sol = (v: unknown, d = 4) => (v === null || v === undefined ? "–" : `${Number(v).toFixed(d)}`);

async function postJson(url: string) {
  const r = await fetch(url, { method: "POST" });
  if (r.status === 401) location.href = "/login";
  return { ok: r.ok, body: await r.json().catch(() => ({})) };
}

async function loadPositions() {
  const rows = await getJson("/api/positions");
  $("#positions tbody").innerHTML = rows.length
    ? rows
        .map((p) => {
          const mint = String(p.mint);
          const exitState = [
            Number(p.ladderDone) > 0 ? `TP ${p.ladderDone}` : "",
            p.breakEvenArmed ? "BE aktif" : "",
          ]
            .filter(Boolean)
            .join(", ");
          return `<tr><td>${esc(p.id)}</td>
          <td>${p.symbol ? `<b>${esc(p.symbol)}</b> ` : ""}<a href="#" data-mint="${esc(mint)}"><code>${esc(short(mint))}</code></a></td>
          <td>${esc(p.profile)}</td><td>${dur(Date.now() - Number(p.openedAt))}</td><td>${sol(p.costSol)}</td>
          <td>${pct(p.pnlPct)} <span class="muted" title="sumber PnL">${p.pnlSource === "quote" ? `quote ${p.quoteAgeSec ?? "?"}dtk` : "estimasi"}</span></td><td>${pct(p.peakPnlPct)}</td><td>${(Number(p.soldFrac) * 100).toFixed(0)}%</td>
          <td>${esc(exitState || "–")}</td>
          <td><button type="button" class="btn small" data-close="${esc(p.id)}">Jual</button></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="10" class="muted">Tidak ada posisi terbuka.</td></tr>`;
}

document.addEventListener("click", async (ev) => {
  const el = ev.target as HTMLElement;
  const ctl = el.closest<HTMLElement>("[data-control]")?.dataset.control;
  if (ctl) {
    const warn: Record<string, string> = {
      kill: "Stop semua entry baru? (posisi tetap dikelola exit engine)",
      panic: "PANIC: jual SEMUA posisi sekarang dan stop entry?",
    };
    if (warn[ctl] && !confirm(warn[ctl])) return;
    const r = await postJson(`/api/control/${ctl}`);
    $("#control-msg").textContent = r.ok ? `${ctl} OK` : `gagal: ${JSON.stringify(r.body)}`;
    void refresh();
    return;
  }
  const id = el.closest<HTMLElement>("[data-close]")?.dataset.close;
  if (id) {
    if (!confirm(`Jual posisi #${id} 100% sekarang?`)) return;
    const r = await postJson(`/api/positions/${id}/close`);
    toast(r.ok ? `Posisi #${id} dijual` : `Gagal jual #${id}`);
    void loadPositions();
  }
});

// ---------- trades ----------
async function loadTrades() {
  const { kpi, reasons, equity, trades } = await getJson<{
    kpi: Row;
    reasons: Row[];
    equity: Row[];
    trades: Row[];
  }>("/api/trades?mode=paper");
  $("#trade-kpi").innerHTML =
    card("Hasil (paper)", kpi.trades ? Number(kpi.pnl_sol) >= 0 : null, [
      ["trade selesai", kpi.trades],
      ["win rate", kpi.win_rate !== null ? `${kpi.win_rate}%` : "–"],
      ["PnL total", `${sol(kpi.pnl_sol)} SOL`],
      ["PnL hari ini", `${sol(kpi.pnl_today_sol)} SOL`],
    ]) +
    card("Kualitas", null, [
      ["profit factor", kpi.profit_factor ?? "–"],
      ["expectancy / trade", `${sol(kpi.expectancy_sol, 5)} SOL`],
      ["rata-rata win", kpi.avg_win_pct !== null ? `+${kpi.avg_win_pct}%` : "–"],
      ["rata-rata loss", kpi.avg_loss_pct !== null ? `${kpi.avg_loss_pct}%` : "–"],
    ]) +
    card("Biaya", null, [
      ["fee jaringan total", `${sol(kpi.fees_sol)} SOL`],
      ["entry gagal (simulasi)", kpi.entry_failed],
    ]);
  $("#trade-equity").innerHTML = sparkline(equity.map((e) => Number(e.equity)));
  $("#trade-reasons tbody").innerHTML = reasons.length
    ? reasons
        .map(
          (r) => `<tr><td>${esc(r.exit_reason)}</td><td>${num(r.n)}</td><td>${pct(r.avg_pnl_pct)}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="muted">Belum ada trade selesai.</td></tr>`;
  $("#trades tbody").innerHTML = trades.length
    ? trades
        .map((t) => {
          const mint = String(t.mint);
          const failed = t.status === "ENTRY_FAILED";
          const d =
            t.closed_at && t.opened_at
              ? dur(new Date(String(t.closed_at)).getTime() - new Date(String(t.opened_at)).getTime())
              : "–";
          return `<tr><td>${esc(t.id)}</td><td>${t.closed_at ? wibFull.format(new Date(String(t.closed_at))) : "–"}</td>
          <td>${t.symbol ? `<b>${esc(t.symbol)}</b> ` : ""}<a href="#" data-mint="${esc(mint)}"><code>${esc(short(mint))}</code></a></td>
          <td>${esc(t.profile)}</td><td>${d}</td><td>${sol(t.cost_sol ?? t.size_sol)}</td>
          <td>${failed ? "–" : sol(t.realized_pnl_sol)}</td><td>${failed ? "–" : pct(t.pnl_pct)}</td><td>${pct(t.mfe_pct)}</td>
          <td>${sol(t.fees_sol, 5)}</td><td>${failed ? `<span class="tag bad">entry gagal: ${esc(t.exit_reason)}</span>` : esc(t.exit_reason)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="11" class="muted">Belum ada trade.</td></tr>`;
}

// ---------- wallet tracker ----------
const usd = (v: unknown) =>
  v === null || v === undefined ? "–" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

async function loadWallets() {
  const q = `hours=${$<HTMLSelectElement>("#w-hours").value}&kind=${$<HTMLSelectElement>("#w-kind").value}&tier=${$<HTMLSelectElement>("#w-tier").value}`;
  const rows = await getJson(`/api/wallets?${q}`);
  $("#wallets tbody").innerHTML = rows.length
    ? rows
        .map((w) => {
          const a = String(w.wallet);
          const tags = [...((w.tags as string[] | null) ?? []), ...(w.is_dev ? ["dev"] : [])];
          const parts = (w.score_parts ?? {}) as Record<string, unknown>;
          const scoreTitle = Object.entries(parts)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          const scoreCell =
            w.score === null || w.score === undefined
              ? `<span class="muted">–</span>`
              : `<span class="${Number(w.score) >= 60 ? "up" : ""}" title="${esc(scoreTitle)}">${Number(w.score).toFixed(0)}</span>`;
          return `<tr><td><a href="#" data-wallet="${esc(a)}"><code>${esc(short(a))}</code></a></td>
          <td>${scoreCell}</td>
          <td>${num(w.tokens)}</td><td>${num(w.as_top_holder)}</td><td>${num(w.as_big_buyer)}</td>
          <td>${usd(w.buy_usd)}</td><td>${usd(w.profit_usd)}</td>
          <td>${tags.map((t) => `<span class="tag${t === "smart_degen" ? " ok" : t === "dev" || t === "bundler" ? " bad" : ""}">${esc(t)}</span>`).join(" ")}</td>
          <td>${wib.format(new Date(String(w.last_seen)))}</td>
          <td><button type="button" class="btn small" data-watch="${esc(a)}" data-on="${w.watched ? "0" : "1"}">${w.watched ? (w.auto ? "★ otomatis" : "★ dipantau") : "☆ pantau"}</button></td></tr>`;
        })
        .join("")
    : `<tr><td colspan="10" class="muted">Belum ada data — scan holder jalan ±2 menit setelah token dievaluasi.</td></tr>`;
  await loadSmart();
}

const srcLabel: Record<string, string> = {
  holder_scan: "scan holder",
  wallet_activity: "aktivitas wallet",
  gmgn_feed: "feed GMGN",
  mixed: "campuran",
};

async function loadSmart() {
  const { signals, summary } = await getJson<{ signals: Row[]; summary: Row }>(
    `/api/smart-signals?hours=${$<HTMLSelectElement>("#w-hours").value}`,
  );
  $("#smart-summary").innerHTML =
    card("Watchlist", null, [
      ["otomatis (skor ≥ 60)", summary.auto_active],
      ["manual", summary.manual_active],
      ["wallet bernilai skor", summary.scored],
      ["skor tertinggi", summary.max_score ?? "–"],
    ]) + card("Sinyal", null, [["konfluensi (rentang ini)", signals.length]]);
  $("#smart-signals tbody").innerHTML = signals.length
    ? signals
        .map((x) => {
          const mint = String(x.mint);
          const wallets = (x.wallets as string[]) ?? [];
          const filter =
            x.filter_passed === null || x.filter_passed === undefined
              ? `<span class="muted">–</span>`
              : x.filter_passed
                ? `<span class="tag ok">lolos</span>`
                : `<span class="tag bad">ditolak</span>`;
          return `<tr><td>${wib.format(new Date(String(x.ts)))}</td>
          <td>${x.symbol ? `<b>${esc(x.symbol)}</b> ` : ""}<a href="#" data-mint="${esc(mint)}"><code>${esc(short(mint))}</code></a></td>
          <td>${esc(srcLabel[String(x.source)] ?? x.source)}</td>
          <td>${wallets.map((w) => `<a href="#" data-wallet="${esc(w)}"><code>${esc(short(w))}</code></a>`).join(" ")}</td>
          <td>${num(x.avg_score)}</td><td>${filter}</td><td>${num(x.position)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="7" class="muted">Belum ada konfluensi.</td></tr>`;
}

async function loadWalletDetail(address: string) {
  const rows = await getJson(`/api/wallets/${encodeURIComponent(address)}`);
  $("#wallet-detail").innerHTML = `<h2>Wallet <code>${esc(address)}</code></h2>
    <p><a href="https://gmgn.ai/sol/address/${encodeURIComponent(address)}" target="_blank" rel="noopener noreferrer">GMGN</a> ·
       <a href="https://solscan.io/account/${encodeURIComponent(address)}" target="_blank" rel="noopener noreferrer">Solscan</a></p>
    <div class="scroll"><table><thead><tr><th>Waktu</th><th>Token</th><th>Jenis</th><th>% supply</th><th>Beli</th><th>Jual</th><th>Profit</th><th>Max token</th><th>Tag</th></tr></thead><tbody>
    ${rows
      .map(
        (r) => `<tr><td>${wib.format(new Date(String(r.ts)))}</td>
      <td>${r.symbol ? `<b>${esc(r.symbol)}</b> ` : ""}<a href="#" data-mint="${esc(r.mint)}"><code>${esc(short(String(r.mint)))}</code></a></td>
      <td>${r.kind === "top_holder" ? `top #${esc(r.rank)}` : `beli ≥ ${usd(r.buy_tier_usd)}`}</td>
      <td>${num(r.amount_pct !== null ? `${Number(r.amount_pct).toFixed(2)}%` : null)}</td><td>${usd(r.buy_volume_usd)}</td><td>${usd(r.sell_volume_usd)}</td>
      <td>${usd(r.profit_usd)}</td><td>${pct(r.max_ret)}</td>
      <td>${[...((r.tags as string[]) ?? []), ...((r.maker_tags as string[]) ?? [])].map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

for (const id of ["#w-hours", "#w-kind", "#w-tier"])
  $<HTMLSelectElement>(id).onchange = () => void loadWallets();
document.addEventListener("click", async (ev) => {
  const el = ev.target as HTMLElement;
  const w = el.closest<HTMLElement>("a[data-wallet]");
  if (w) {
    ev.preventDefault();
    void loadWalletDetail(w.dataset.wallet!);
    return;
  }
  const watch = el.closest<HTMLElement>("[data-watch]");
  if (watch) {
    const r = await postJson(
      `/api/wallets/${watch.dataset.watch}/${watch.dataset.on === "1" ? "watch" : "unwatch"}`,
    );
    toast(r.ok ? "Watchlist diperbarui" : "Gagal memperbarui watchlist");
    void loadWallets();
  }
});

// ---------- backtest ----------
let btProfilesLoaded = false;
async function loadCosts() {
  const { buckets, counts } = await getJson<{ buckets: Row[]; counts: Row }>("/api/costs?hours=24");
  $("#bt-costs").innerHTML = buckets.length
    ? `<table><thead><tr><th>Likuiditas</th><th>probe</th><th>median total</th><th>p75 total</th><th>median quote (fee+impact)</th><th>jaringan</th></tr></thead><tbody>
      ${buckets
        .map(
          (b) =>
            `<tr><td>${esc(b.bucket)}</td><td>${num(b.n)}</td><td><b>${num(b.med_total)}%</b></td><td>${num(b.p75_total)}%</td><td>${num(b.med_quote)}%</td><td>${num(b.network)}%</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table><p class="muted">${counts.total} probe (${counts.failed} gagal), median total ${counts.med_total ?? "–"}%.</p>`
    : `<p class="muted">Belum ada probe — jalan otomatis tiap 60 dtk untuk token yang baru dievaluasi.</p>`;
}

async function initBacktest() {
  void loadCosts();
  if (btProfilesLoaded) return;
  const f = await getJson<{ funnel: Row[] }>("/api/pipeline?hours=168");
  const sel = $<HTMLSelectElement>("#bt-profile");
  for (const r of f.funnel)
    sel.insertAdjacentHTML("beforeend", `<option value="${esc(r.profile)}">${esc(r.profile)}</option>`);
  btProfilesLoaded = true;
}

$("#bt-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const cost = $<HTMLInputElement>("#bt-cost").value;
  const q = new URLSearchParams({
    profile: $<HTMLSelectElement>("#bt-profile").value,
    universe: $<HTMLSelectElement>("#bt-universe").value,
    hours: $<HTMLSelectElement>("#bt-hours").value,
    tps: $<HTMLInputElement>("#bt-tps").value,
    sls: $<HTMLInputElement>("#bt-sls").value,
    entry_cost: cost,
    exit_cost: cost,
    wf_folds: $<HTMLInputElement>("#bt-folds").value,
  });
  $("#bt-result").innerHTML = `<p class="muted">Menghitung…</p>`;
  const r = await getJson<{
    candidates: number;
    exitRef: string;
    current: Row;
    tps: number[];
    sls: number[];
    cells: Row[];
    walkForward: {
      folds: {
        fold: number;
        testFrom: number;
        testTo: number;
        best: Row | null;
        test: Row | null;
        testCurrent: Row;
      }[];
      oos: Row;
      oosCurrent: Row;
      distinctBest: number;
    } | null;
  }>(`/api/backtest?${q}`);
  if ((r as unknown as Row).error) {
    $("#bt-result").innerHTML = `<p class="bad">${esc((r as unknown as Row).error)}</p>`;
    return;
  }
  const m = r.current;
  const reasons = Object.entries((m.reasons ?? {}) as Record<string, number>)
    .map(([k, v]) => `${esc(k)}: ${v}`)
    .join(", ");
  const best = Math.max(...r.cells.map((c) => Number(c.expectancyPct ?? -1e9)));
  const cell = (tp: number, sl: number) => {
    const c = r.cells.find((x) => x.tp === tp && x.sl === sl);
    if (!c || c.expectancyPct === null) return `<td class="muted">–</td>`;
    const e = Number(c.expectancyPct);
    const a = Math.min(1, Math.abs(e) / 5).toFixed(2);
    const bg = e >= 0 ? `rgb(60 207 145 / ${a})` : `rgb(239 90 111 / ${a})`;
    return `<td style="background:${bg}${e === best ? ";outline:2px solid var(--accent)" : ""}" title="PF ${c.profitFactor ?? "–"}, median ${c.medianPct}%, n ${c.trades}">${e > 0 ? "+" : ""}${e.toFixed(2)}% <span class="muted">(${c.winRate}%)</span></td>`;
  };
  $("#bt-result").innerHTML = `
    <div class="grid">${card(
      `Exit sekarang (${esc(r.exitRef)})`,
      m.expectancyPct === null ? null : Number(m.expectancyPct) > 0,
      [
        ["kandidat / trade", `${r.candidates} / ${m.trades}`],
        ["win rate", m.winRate !== null ? `${m.winRate}%` : "–"],
        ["expectancy / trade", m.expectancyPct !== null ? `${m.expectancyPct}%` : "–"],
        ["median / trade", m.medianPct !== null ? `${m.medianPct}%` : "–"],
        ["profit factor", m.profitFactor ?? "–"],
        ["rata-rata win / loss", `${m.avgWinPct ?? "–"}% / ${m.avgLossPct ?? "–"}%`],
      ],
    )}${card("Alasan exit", null, [["", reasons || "–"]])}</div>
    <h2>Sweep TP (jual 100%) × SL</h2>
    <div class="scroll"><table class="heat"><thead><tr><th>TP \\ SL</th>${r.sls.map((sl) => `<th>-${sl}%</th>`).join("")}</tr></thead><tbody>
    ${r.tps.map((tp) => `<tr><th>+${tp}%</th>${r.sls.map((sl) => cell(tp, sl)).join("")}</tr>`).join("")}
    </tbody></table></div>
    <p class="muted">Kotak bergaris = expectancy terbaik. Hati-hati overfitting: pilih area yang konsisten hijau, bukan satu sel terbaik — dan butuh ratusan trade.</p>
    ${walkForwardHtml(r.walkForward)}`;
});

// ---------- walk-forward ----------
type WF = {
  folds: {
    fold: number;
    testFrom: number;
    testTo: number;
    best: Row | null;
    test: Row | null;
    testCurrent: Row;
  }[];
  oos: Row;
  oosCurrent: Row;
  distinctBest: number;
} | null;

function walkForwardHtml(wf: WF) {
  if (!wf) return "";
  const m = (x: Row | null) =>
    x
      ? `${pct(x.expectancyPct)} <span class="muted">(${x.trades} trade, win ${x.winRate ?? "–"}%)</span>`
      : `<span class="muted">–</span>`;
  const verdict =
    wf.oos.expectancyPct === null
      ? "data kurang"
      : Number(wf.oos.expectancyPct) > 0
        ? "positif di data yang belum dilihat ✓"
        : "negatif di data yang belum dilihat ✗";
  return `<h2>Walk-forward (out-of-sample)</h2>
    <div class="grid">
      ${card(
        "Parameter hasil optimasi (OOS)",
        wf.oos.expectancyPct === null ? null : Number(wf.oos.expectancyPct) > 0,
        [
          ["expectancy / trade", wf.oos.expectancyPct !== null ? `${wf.oos.expectancyPct}%` : "–"],
          ["median", wf.oos.medianPct !== null ? `${wf.oos.medianPct}%` : "–"],
          ["trade", wf.oos.trades],
          ["kesimpulan", verdict],
        ],
      )}
      ${card(
        "Exit config sekarang (OOS)",
        wf.oosCurrent.expectancyPct === null ? null : Number(wf.oosCurrent.expectancyPct) > 0,
        [
          [
            "expectancy / trade",
            wf.oosCurrent.expectancyPct !== null ? `${wf.oosCurrent.expectancyPct}%` : "–",
          ],
          ["median", wf.oosCurrent.medianPct !== null ? `${wf.oosCurrent.medianPct}%` : "–"],
          ["trade", wf.oosCurrent.trades],
          ["stabilitas parameter", `${wf.distinctBest} kombinasi berbeda dari ${wf.folds.length} fold`],
        ],
      )}
    </div>
    <div class="scroll"><table><thead><tr><th>Fold</th><th>Periode uji (WIB)</th><th>Terbaik di latih</th><th>Hasil di uji</th><th>Config sekarang di uji</th></tr></thead><tbody>
    ${wf.folds
      .map(
        (
          f,
        ) => `<tr><td>${f.fold}</td><td>${wibFull.format(new Date(f.testFrom))} – ${wib.format(new Date(f.testTo))}</td>
        <td>${f.best ? `TP +${f.best.tp}% / SL −${f.best.sl}% <span class="muted">(latih ${pct(f.best.trainExpectancyPct)}, ${f.best.trainTrades} trade)</span>` : `<span class="muted">trade latih kurang</span>`}</td>
        <td>${m(f.test)}</td><td>${m(f.testCurrent)}</td></tr>`,
      )
      .join("")}</tbody></table></div>
    <p class="muted">Tiap fold: TP×SL terbaik dipilih dari data sebelumnya lalu diuji di periode berikutnya. Kalau OOS jauh lebih jelek dari sweep biasa → hasil sweep overfit. Parameter yang sering berubah antar fold = tidak stabil.</p>`;
}

// ---------- config editor ----------
let cfgLoadedKind = "";

function diffHtml(diff: string) {
  if (!diff.trim()) return `<p class="muted">Tidak ada perubahan.</p>`;
  return `<pre class="diff">${diff
    .split("\n")
    .map(
      (l) => `<span class="${l.startsWith("+ ") ? "add" : l.startsWith("- ") ? "del" : ""}">${esc(l)}</span>`,
    )
    .join("\n")}</pre>`;
}

async function sendJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 401) location.href = "/login";
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Row };
}

async function loadConfigTab(force = false) {
  const kind = $<HTMLSelectElement>("#cfg-kind").value;
  if (force || cfgLoadedKind !== kind) {
    const c = await getJson<Row>(`/api/config/${kind}`);
    $<HTMLTextAreaElement>("#cfg-yaml").value = String(c.yaml ?? "");
    $("#cfg-version").textContent = c.version ? `aktif: v${c.version}` : "";
    $("#cfg-result").innerHTML = "";
    cfgLoadedKind = kind;
  }
  const versions = await getJson(`/api/config/${kind}/versions`);
  $("#cfg-versions tbody").innerHTML = versions
    .map(
      (v) => `<tr><td>v${esc(v.id)}</td><td>${wibFull.format(new Date(String(v.created_at)))}</td>
      <td>${esc(v.author)}${v.note ? ` — ${esc(v.note)}` : ""}</td><td><code>${esc(v.hash)}</code></td>
      <td>${v.active ? '<span class="tag ok">aktif</span>' : ""}</td>
      <td><button type="button" class="btn small" data-cfgview="${esc(v.id)}">Lihat</button>
          ${v.active ? "" : `<button type="button" class="btn small warn" data-cfgrollback="${esc(v.id)}">Rollback</button>`}</td></tr>`,
    )
    .join("");
}

function showValidation(r: Row) {
  const issues = (r.issues as string[]) ?? [];
  const blocked = (r.blocked as string[]) ?? [];
  let html = "";
  if (issues.length)
    html += `<div class="bad"><b>Tidak valid:</b><ul>${issues.map((i) => `<li><code>${esc(i)}</code></li>`).join("")}</ul></div>`;
  if (blocked.length)
    html += `<div class="bad"><b>Ditolak (mode live tidak boleh dari dashboard):</b> ${blocked.map((b) => `<code>${esc(b)}</code>`).join(", ")}</div>`;
  if (!issues.length && !blocked.length)
    html += `<p class="ok">Valid${r.changed ? "" : " — tidak ada perubahan"}.</p>`;
  html += diffHtml(String(r.diff ?? ""));
  $("#cfg-result").innerHTML = html;
}

$<HTMLSelectElement>("#cfg-kind").onchange = () => void loadConfigTab();
$("#cfg-reload").addEventListener("click", () => void loadConfigTab(true));
$("#cfg-validate").addEventListener("click", async () => {
  const kind = $<HTMLSelectElement>("#cfg-kind").value;
  const r = await sendJson(`/api/config/${kind}/validate`, {
    yaml: $<HTMLTextAreaElement>("#cfg-yaml").value,
  });
  showValidation(r.body);
});
$("#cfg-save").addEventListener("click", async () => {
  const kind = $<HTMLSelectElement>("#cfg-kind").value;
  const yaml = $<HTMLTextAreaElement>("#cfg-yaml").value;
  const check = await sendJson(`/api/config/${kind}/validate`, { yaml });
  showValidation(check.body);
  if (!check.body.ok || !check.body.changed) return;
  if (!confirm(`Simpan ${kind}.yaml sebagai versi baru? Perubahan langsung dipakai bot.`)) return;
  const r = await sendJson(`/api/config/${kind}`, { yaml, note: $<HTMLInputElement>("#cfg-note").value });
  if (r.status === 200) {
    toast(`${kind}.yaml disimpan (v${r.body.version})`);
    $<HTMLInputElement>("#cfg-note").value = "";
    await loadConfigTab(true);
    showValidation(r.body);
  } else showValidation(r.body);
});
document.addEventListener("click", async (ev) => {
  const el = ev.target as HTMLElement;
  const kind = $<HTMLSelectElement>("#cfg-kind").value;
  const view = el.closest<HTMLElement>("[data-cfgview]")?.dataset.cfgview;
  if (view) {
    const v = await getJson<Row>(`/api/config/${kind}/versions/${view}`);
    $("#cfg-view").innerHTML =
      `<h2>Versi v${esc(v.id)} — ${esc(v.author)}${v.note ? ` (${esc(v.note)})` : ""}</h2>
      ${v.diff ? `<h3 class="sub">Perubahan saat disimpan</h3>${diffHtml(String(v.diff))}` : ""}
      <h3 class="sub">Isi lengkap</h3><pre class="features">${esc(v.yaml)}</pre>`;
    return;
  }
  const rb = el.closest<HTMLElement>("[data-cfgrollback]")?.dataset.cfgrollback;
  if (rb) {
    if (!confirm(`Rollback ${kind}.yaml ke v${rb}? Bot langsung memakai config itu.`)) return;
    const r = await sendJson(`/api/config/${kind}/rollback/${rb}`, {});
    toast(r.status === 200 ? `Rollback ke v${rb} berhasil` : `Rollback gagal`);
    await loadConfigTab(true);
    showValidation(r.body);
  }
});

// ---------- toast ----------
function toast(msg: string) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 6000);
}

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
    if (e.t === "Position") {
      const label = e.symbol ?? short(String(e.mint));
      const msg: Record<string, string> = {
        opened: `ENTRY ${label} (${e.profile})`,
        partial: `Jual sebagian ${label} — ${e.reason}`,
        closed: `EXIT ${label} ${e.pnlPct >= 0 ? "+" : ""}${Number(e.pnlPct).toFixed(1)}% — ${e.reason}`,
        entry_failed: `Entry gagal ${label}: ${e.reason}`,
      };
      if (msg[e.action]) toast(msg[e.action]!);
      if (current === "positions") void loadPositions();
    }
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
    else if (current === "lab") await loadLab();
    else if (current === "pipeline") await loadPipeline();
    else if (current === "positions") await loadPositions();
    else if (current === "trades") await loadTrades();
    else if (current === "wallets") await loadWallets();
    else if (current === "backtest")
      await initBacktest(); // hasil tidak auto-refresh
    else if (current === "config" && cfgLoadedKind === "") await loadConfigTab(); // editor tidak di-refresh otomatis
    // tab token tidak auto-refresh (hindari menimpa saat dibaca)
  } catch (err) {
    console.error(err);
  }
}

connectWs();
void refresh();
setInterval(() => void refresh(), 10_000);
