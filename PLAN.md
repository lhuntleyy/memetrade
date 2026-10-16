# PLAN — memebot: Bot Trading Memecoin Solana Multi-Timeframe + Web Monitoring

> Dibuat 2026-10-17. Dokumen hidup — revisi dicatat di `PROGRESS.md` (log) dan `docs/DECISIONS.md`.
> **Bukan financial advice.** Memecoin ±99% berakhir mati/rug. Target proyek ini adalah *sistem yang terukur*, bukan janji profit.

## 1. Tujuan

1. Bot otomatis yang trading memecoin Solana dengan **beberapa profile** (degen detik–menit, momentum menit–jam, swing jam–hari) dan konfirmasi **multi-timeframe**.
2. **Web monitoring** real-time (Bun) untuk posisi, PnL, pipeline, analitik riset, kontrol (pause/kill/panic), dan config.
3. Proses berbasis data: **observasi → filter → paper → replay → micro-live → scale**, dengan kriteria lanjut/berhenti yang jelas.
4. LLM dipakai di tempat yang tepat: builder (dev-time) + analis async (narrative, parser call, review harian), **bukan** pengambil keputusan entry/exit.

### Non-tujuan (setidaknya sampai Fase 6)
- Sniping detik pertama melawan bot co-located.
- Market making, bundling, atau apa pun yang memanipulasi pasar.
- Custodial / menjalankan dana orang lain.

## 2. Ringkasan keputusan

| Area | Keputusan | Detail |
|---|---|---|
| Bahasa & runtime | **TypeScript + Bun 1.4** untuk semuanya | `docs/03-architecture.md` |
| Arsitektur | Modular monolith `memebot-core` + proses terpisah `dashboard` & `llm-worker` | `docs/03` |
| Database | **PostgreSQL 17 + TimescaleDB** (candle multi-TF via continuous aggregate) | `docs/03 §6` |
| Dashboard | Bun fullstack + **Elysia** + React 19 + Tailwind v4 + shadcn + lightweight-charts; akses via **Tailscale** | `docs/06` |
| Trigger awal | PumpPortal (new token, migration), DexScreener (profiles/boosts), GMGN (trending/trenches/signal) | `docs/02 §1` |
| Data filter | GMGN + Jupiter Tokens v2 (organic score/audit) + on-chain sendiri; cross-check Solana Tracker/RugCheck | `docs/02 §2` |
| Harga real-time | Trade stream + `accountSubscribe` vault pool → **quote lokal** dari reserve (bukan polling Jupiter) | `docs/02 §3` |
| Eksekusi | **Jupiter Swap API V2** (`/order`+`/execute`) default; `/build` + Helius Sender (SG) & pump SDK langsung sebagai jalur kontrol/fallback | `docs/05 §3` |
| Strategi awal | `migration_momentum` + `trending_momentum` (paper) | `docs/04` |
| Risk | Limit global & per profile, daily stop, circuit breaker, kill switch 3 tempat | `docs/05 §1` |
| LLM | Async worker Anthropic; default `claude-opus-5-5`, opsi `claude-haiku-5-5` untuk tagger (keputusan user) | `docs/08` |
| Proses di VPS | systemd per service, tanpa Docker/Redis/Grafana dulu (RAM 2 GB) | `docs/07` |

## 3. Peta dokumen

| File | Isi |
|---|---|
| `README.md` | Pintu masuk & status singkat |
| `PLAN.md` | Dokumen ini — tujuan, fase, budget, risiko |
| `PROGRESS.md` | Checklist task per fase + log harian |
| `CLAUDE.md` | Aturan kerja untuk AI agent di repo ini |
| `docs/01-review-post.md` | Review post referensi + repo GMGN + detail LLM-nya |
| `docs/02-research.md` | Riset provider, harga, limit, lanskap, referensi (dengan link) |
| `docs/03-architecture.md` | Arsitektur, modul, stack, struktur repo, skema DB, event |
| `docs/04-strategy.md` | Profile, multi-timeframe, filter, security, exit, contoh config |
| `docs/05-risk-and-execution.md` | Risk manager, ekonomi trade, eksekusi live, paper realistis, tangga go-live |
| `docs/06-dashboard.md` | Spesifikasi web monitoring + API + Telegram |
| `docs/07-vps-setup.md` | Kondisi VPS, yang sudah dikerjakan, hardening, install komponen |
| `docs/08-llm.md` | Peran LLM, model, biaya, guardrail |
| `docs/09-evaluation.md` | Data, metrik, replay/backtest, kriteria lanjut fase |
| `docs/DECISIONS.md` | Log keputusan arsitektur (ADR singkat) |

## 4. Fase & milestone

Estimasi durasi = waktu kerja + waktu bot "jalan ngumpulin data". Fase dengan label **(run)** butuh waktu kalender, bukan cuma ngoding.

### Fase 0 — Fondasi (1–2 hari)
**Tujuan:** VPS aman & siap, repo skeleton, DB, config schema.
- VPS: reboot kernel baru, hardening SSH/ufw/fail2ban (setelah konfirmasi user), swappiness, journald limit.
- Install PostgreSQL 17 + TimescaleDB (tuned 2 GB), Tailscale.
- Repo Bun workspaces (`apps/core`, `apps/dashboard`, `apps/llm-worker`, `apps/cli`, `packages/{shared,db,solana}`), tsconfig strict, lint/format, `bun test`.
- `packages/shared`: zod schema config (strategy/trade/sources/llm) + loader YAML + hot reload + versioning ke DB.
- `packages/db`: drizzle schema + migration awal + hypertable/continuous aggregate SQL.
- Logging pino, health endpoint, systemd unit template, `.env.example`, `CLAUDE.md` + deny rule secret.
- git init + repo private.
**Selesai kalau:** `bun test` hijau, migration jalan, `memebot-core` start/stop via systemd dengan health OK.

### Fase 1 — Observasi data (2–3 hari build + 7–14 hari **run**)
**Tujuan:** tahu sifat token dari tiap sumber sebelum menulis logika beli.
- Collector: PumpPortal (`subscribeNewToken`, `subscribeMigration`), DexScreener (profiles, boosts latest/top), GMGN (trending, trenches, hot), (opsional) Meteora pools.
- Market tracker: subscribe harga token ter-trigger 60–120 menit (PumpPortal trades metered / `accountSubscribe` pool / bonding curve), tick → candle, `tracked_paths`.
- Pool math: harga & quote lokal untuk bonding curve pump.fun dan PumpSwap.
- Dashboard v0: Overview (health), Live Feed, **Trigger Lab** dasar (stat per sumber, heatmap jam).
- Notifier Telegram dasar (health & ringkasan harian).
**Selesai kalau:** kriteria `docs/09 §4` Fase 1→2 terpenuhi. **Output utama: laporan "sumber mana yang punya edge & kapan biasanya dump".**

### Fase 2 — Enrichment, security, filter engine (1–2 minggu)
- Provider adapter (GMGN, Jupiter Tokens v2, Solana Tracker/RugCheck opsional) dengan rate limiter, cache, timeout, null gate, cross-check.
- Security module: authority, Token-2022 extensions, LP, simulasi jual, round-trip quote, blacklist.
- Rule engine YAML + MTF evaluator + scoring; **decision log 100%**.
- **Shadow tracking** token yang ditolak.
- Dashboard: Token Explorer, Pipeline funnel, Filter effectiveness.
**Selesai kalau:** kriteria Fase 2→3.

### Fase 3 — Paper trading (1 minggu build + 2–4 minggu **run**)
- Profile `migration_momentum` & `trending_momentum` (mode paper).
- Risk manager + circuit breaker + kill switch (dashboard, Telegram, file flag).
- Paper executor realistis (latency, quote beneran, fee, p_fail).
- Position manager + exit engine lengkap (SL, ladder, break-even, trailing bertingkat/ATR, momentum-fail, stale, max hold, event exit, panic).
- Journal: orders, fills, positions, position_marks, daily_stats.
- Dashboard: Positions, Trades (detail + chart marker), Overview KPI & equity curve, kontrol.
- Telegram: notifikasi entry/exit + perintah `/status /pnl /pause /kill /panic`.
**Selesai kalau:** ≥ 300 trade paper per profile terkumpul → evaluasi `docs/09 §4`.

### Fase 4 — Research loop & LLM (1–2 minggu, paralel dengan run Fase 3)
- `apps/cli replay`: replay event-driven + parameter sweep + walk-forward.
- Dashboard: Backtest/Replay, Config editor + versi + rollback.
- `memebot-llm`: narrative tagger, daily review (proposal config → replay → approve), biaya & budget.
- Dashboard: AI Insights.
**Selesai kalau:** replay mereproduksi paper; ≥ 1 perbaikan tervalidasi out-of-sample.

### Fase 5 — Micro live (1 minggu build + 2+ minggu **run**)
- Executor live: Jupiter V2 `/order`+`/execute`; `/build` + Helius Sender (SG, fallback Tokyo) untuk exit panic; pump SDK direct sebagai fallback.
- Konfirmasi, parse fill aktual, close ATA, sweep profit (manual/CLI), saldo minimum.
- Hot wallet baru, secrets di `/etc/memebot/secrets.env`, TOTP untuk switch live.
- Kalibrasi paper vs live.
**Syarat masuk:** kriteria go-live terpenuhi + **persetujuan eksplisit user**.
**Selesai kalau:** kriteria Micro → Small live.

### Fase 6 — Scale & ekspansi (berkelanjutan)
- Profile baru: `smart_money` (wallet scoring), `swing_dip`, `near_graduation`, `kol_call` (Telegram userbot + caller scoring), `curve_sniper` (opsional).
- Upgrade data: gRPC (Chainstack $49 / Solana Tracker €200 / Helius LaserStream), provider berbayar kalau terbukti perlu.
- Upgrade VPS ≥ 4 GB, Grafana/Uptime Kuma, backup offsite teruji (restore drill).
- Multi-launchpad (LetsBonk, Bags, Meteora DBC).

## 5. Budget bulanan (perkiraan, di luar VPS)

| Tier | Isi | Perkiraan |
|---|---|---|
| **Lean** (Fase 0–3) | Helius Free→Developer ($0–49), PumpPortal metered (~beberapa 0.01 SOL), GMGN free, DexScreener free, Jupiter free key, GeckoTerminal free | **$0–60** |
| **Standard** (Fase 4–5) | + Helius Developer $49, Solana Tracker Advanced €50, LLM $5–50, Jupiter paid kalau perlu | **$100–250** |
| **Pro** (Fase 6) | + gRPC $49–200, provider premium (Mobula/Birdeye/Solana Tracker Premium €397), Helius Business $499 | **$400–1.000+** |

Modal trading terpisah: paper = 0; micro live = 0.5–1 SOL; naik hanya kalau metrik lulus.

## 6. Risiko proyek & mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Edge tidak ada / hilang | Rugi pelan-pelan | Kriteria go-live ketat, evaluasi rolling 100 trade, turun tahap otomatis |
| Overfitting filter | Paper bagus, live jelek | Walk-forward, batas jumlah fitur, sampel minimal |
| Biaya eksekusi makan profit | Expectancy negatif | Hitung net di semua metrik, `max_fee_pct_of_trade`, jalur langsung, close ATA |
| Rug / honeypot lolos | Loss 100% posisi | Security berlapis, size kecil, event exit, blacklist |
| Exit gagal saat dump | Loss melebihi SL | Panic mode, retry bertingkat, jalur fallback, likuiditas minimum |
| API berubah/deprecated (contoh: Jupiter Ultra → V2) | Bot mati | Adapter terisolasi, health check, alert, fallback |
| Rate limit provider | Data bolong | Rate limiter per provider, cache, stream > polling |
| Bug kode trading | Kerugian cepat | Unit test exit/risk, paper dulu, limit keras, kill switch |
| Kunci bocor | Wallet dikuras | Hot wallet saldo kecil, secret di luar repo, deny rule agent, dashboard privat |
| VPS down / SG outage | Posisi tak terkelola | systemd restart, alert, (opsional) TP/SL server-side GMGN sebagai cadangan |
| RAM 2 GB habis | Crash | Budget RAM, MemoryMax per unit, retensi data, upgrade 4 GB di Fase 6 |

## 7. Butuh keputusan dari lo

1. **Hardening SSH** — boleh gue matiin login password & root (setelah lo pastiin login pakai key jalan)? Dan boleh reboot sekarang untuk kernel baru?
2. **Budget data/API** bulanan: Lean / Standard / Pro?
3. **Modal micro-live** (default plan: 0.5–1 SOL, 0.01–0.03 SOL per trade) dan batas rugi harian.
4. **Akses dashboard**: Tailscale (rekomendasi) / Cloudflare Tunnel / domain publik + login?
5. **API key** yang perlu disiapkan: Helius, Jupiter (portal), GMGN (+ whitelist IP VPS), PumpPortal (kalau pakai trade stream), Anthropic, Telegram bot token.
6. **Model LLM untuk tagger**: Opus 5.5 (default) atau Haiku 5.5 (hemat)?
7. **Zona waktu tampilan**: WIB?
8. Profile yang mau diprioritaskan setelah 2 profile momentum.

## 8. Cara kerja dengan AI agent

- Kerjakan **per fase**, tiap task di `PROGRESS.md` dicentang + catat log singkat (tanggal, apa yang berubah, temuan).
- Keputusan arsitektur → `docs/DECISIONS.md`.
- Setiap perubahan strategi → config version baru, bukan edit kode.
- Agent **tidak pernah**: membaca secret, mengaktifkan mode live, menaikkan limit risk, atau menjalankan repo asing dengan private key — tanpa perintah eksplisit user.
