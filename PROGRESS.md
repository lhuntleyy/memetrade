# PROGRESS

Legenda: `[ ]` belum · `[~]` sedang · `[x]` selesai · `[!]` butuh keputusan user

## Status singkat

| Fase | Status | Catatan |
|---|---|---|
| Perencanaan & riset | ✅ selesai | Dokumen lengkap di `PLAN.md` + `docs/` |
| 0 — Fondasi | 🟢 hampir selesai | Sisa: Security Group Tencent, Tailscale, remote GitHub |
| 1 — Observasi data | ⚪ belum | |
| 2 — Enrichment/security/filter | ⚪ belum | |
| 3 — Paper trading | ⚪ belum | |
| 4 — Research loop & LLM | ⚪ belum | |
| 5 — Micro live | ⚪ belum | Wajib approval user |
| 6 — Scale | ⚪ belum | |

---

## Fase 0 — Fondasi

### VPS
- [x] P0-01 `apt update` + `full-upgrade` (108 paket, kernel 6.8.0-147)
- [x] P0-02 Paket dasar (build-essential, jq, htop, tmux, unzip, sqlite3, dll)
- [x] P0-03 Install Bun (1.4.3)
- [x] P0-04 Reboot untuk kernel baru (kernel aktif 6.8.0-147)
- [x] P0-05 Hardening SSH (no password, no root, MaxAuthTries 4) via `/etc/ssh/sshd_config.d/01-hardening.conf`
- [x] P0-06 ufw (deny in, allow OpenSSH) + fail2ban jail sshd (journalmatch `_COMM=sshd`, ban 1 jam)
- [x] P0-07 swappiness 10, batas journald 1 GB
- [ ] P0-08 Cek Security Group Tencent (inbound 22 saja)
- [x] P0-09 User service `memebot`, direktori `/etc/memebot`, `/var/lib/memebot`, `/run/memebot`
- [x] P0-10 PostgreSQL 17.11 + TimescaleDB 2.30.2, tuning 2 GB (`infra/postgres/memebot.conf`), role `memebot` & `memebot_ro`
- [!] P0-11 Tailscale (atau alternatif akses dashboard)

### Repo
- [x] P0-12 git init + `.gitignore` + commit awal di `main` (remote GitHub private belum dibuat)
- [x] P0-13 Bun workspaces: `apps/{core,dashboard,llm-worker,cli}`, `packages/{shared,db,solana}`
- [x] P0-14 tsconfig strict (TS 7.0), Biome 2.5 (preset recommended), `bun test` jalan
- [x] P0-15 zod schema config (strategy, trade, sources, llm) + loader YAML + hot reload + versi ke DB
- [x] P0-16 `config/{strategy,trade,sources,llm}.yaml` (default semua paper)
- [x] P0-17 Migrasi SQL `0001_init` (8 hypertable, candle CAGG 15s→4h, kompresi & retensi) + runner (ADR-009)
- [x] P0-18 Logger pino + health endpoint + event bus typed
- [x] P0-19 systemd unit template (`infra/systemd/`, belum di-install)
- [x] P0-20 `.claude/settings.json` deny baca `/etc/memebot/**` & `.env*`
- [x] P0-21 `.env.example`

## Fase 1 — Observasi data
- [ ] P1-01 Collector PumpPortal (new token + migration), 1 koneksi, reconnect + backoff
- [ ] P1-02 Collector DexScreener (profiles, boosts latest/top) + rate limiter
- [!] P1-03 Collector GMGN (trending, trenches, hot) — butuh API key + whitelist IP
- [ ] P1-04 Collector Meteora (opsional)
- [ ] P1-05 Dedupe & normalisasi trigger → `token_triggers`, `tokens`
- [ ] P1-06 Pool math: bonding curve pump.fun & PumpSwap (harga, quote lokal) + unit test
- [ ] P1-07 Market tracker: subscribe harga 60–120 menit per token (stream/accountSubscribe)
- [ ] P1-08 Tick → candle (in-memory 1s/15s + Timescale CAGG 1m..4h)
- [ ] P1-09 Hitung `tracked_paths` (ret, max/min, waktu, rugged)
- [ ] P1-10 Dashboard v0: server Bun + Elysia + SPA shell + auth
- [ ] P1-11 Dashboard: Overview (health), Live Feed
- [ ] P1-12 Dashboard: Trigger Lab (stat per sumber, heatmap jam)
- [ ] P1-13 Telegram notifier dasar
- [ ] P1-14 Jalankan ≥ 7–14 hari, tulis laporan observasi di log

## Fase 2 — Enrichment, security, filter
- [ ] P2-01 Provider adapter GMGN (token info/security/holders, created-tokens)
- [ ] P2-02 Provider adapter Jupiter Tokens v2 (organic score, audit)
- [ ] P2-03 Provider Solana Tracker / RugCheck (cross-check, opsional)
- [ ] P2-04 Rate limiter, cache, timeout, null gate, cross-check
- [ ] P2-05 Security: authority + Token-2022 extension parser
- [ ] P2-06 Security: simulasi jual + round-trip quote + blacklist
- [ ] P2-07 Rule engine YAML + MTF evaluator + scoring + decision log
- [ ] P2-08 Shadow tracking token ditolak
- [ ] P2-09 Dashboard: Token Explorer, Pipeline funnel, Filter effectiveness
- [ ] P2-10 Review manual 50 token rug vs hasil security/filter

## Fase 3 — Paper trading
- [ ] P3-01 Profile `migration_momentum`
- [ ] P3-02 Profile `trending_momentum`
- [ ] P3-03 Risk manager + circuit breaker + kill switch (file, dashboard, Telegram)
- [ ] P3-04 Paper executor realistis (latency, quote, fee, p_fail)
- [ ] P3-05 Position manager + exit engine lengkap + unit test
- [ ] P3-06 Journal (orders, fills, positions, marks, daily_stats)
- [ ] P3-07 Dashboard: Positions, Trades, KPI, equity curve, kontrol
- [ ] P3-08 Telegram: entry/exit + perintah
- [ ] P3-09 Kumpulkan ≥ 300 trade/profile → evaluasi go-live

## Fase 4 — Research loop & LLM
- [ ] P4-01 CLI replay event-driven
- [ ] P4-02 Parameter sweep + walk-forward
- [ ] P4-03 Dashboard: Backtest/Replay + Config editor/versi/rollback
- [!] P4-04 LLM worker + narrative tagger (pilih model) + budget harian
- [ ] P4-05 Daily review + proposal config → replay → approve
- [ ] P4-06 Dashboard: AI Insights

## Fase 5 — Micro live (butuh approval eksplisit)
- [ ] P5-01 Executor Jupiter V2 `/order` + `/execute`
- [ ] P5-02 `/build` + Helius Sender (SG, fallback Tokyo) untuk exit panic
- [ ] P5-03 Pump SDK direct (fallback exit)
- [ ] P5-04 Konfirmasi + parse fill + close ATA
- [!] P5-05 Hot wallet baru + secrets + TOTP switch live
- [ ] P5-06 Kalibrasi paper vs live
- [ ] P5-07 ≥ 100 trade live → evaluasi

## Fase 6 — Scale
- [ ] P6-01 Profile `smart_money` + wallet scoring
- [ ] P6-02 Profile `swing_dip` (+ backfill GeckoTerminal)
- [ ] P6-03 Profile `near_graduation`
- [ ] P6-04 Profile `kol_call` (mtcute userbot + caller scoring)
- [ ] P6-05 gRPC streaming
- [ ] P6-06 Upgrade VPS 4 GB + Grafana/Uptime Kuma
- [ ] P6-07 Backup offsite + restore drill
- [ ] P6-08 Multi-launchpad (LetsBonk, Bags, Meteora DBC)

---

## Log

### 2026-10-17
- Riset: post referensi, repo GMGN (`gmgn-skills`, `skillmarket-demos/aitrader`), API Jupiter/Helius/PumpPortal/DexScreener/Solana Tracker/Meteora/RugCheck/Birdeye/GeckoTerminal, lanskap launchpad, riset sniper cohort, pelajaran Alpha Arena.
- Temuan penting:
  - Jupiter **Ultra API deprecated** → pakai **Swap API V2** (`/order`, `/execute`, `/build`). Free key 1 RPS; platform fee 50 bps untuk token < 24 jam.
  - LLM di post = coding agent; demo GMGN aitrader: LLM cuma explain (masih placeholder), TP/SL belum dieksekusi.
  - PumpPortal: new token & migration gratis, trade stream metered 0.01 SOL/10k event, wajib 1 koneksi.
  - Helius Sender punya endpoint Singapore; tip SWQoS-only min 0.000005 SOL.
- VPS: Tencent Cloud Singapore, 2 vCPU / 1.9 GB / 40 GB, Ubuntu 24.04.4. Update + full-upgrade selesai, paket dasar + Bun 1.4.3 terpasang. **Perlu reboot** (kernel 6.8.0-147). SSH masih izinkan password & root → hardening menunggu konfirmasi.
- Dokumen dibuat: `README.md`, `PLAN.md`, `PROGRESS.md`, `CLAUDE.md`, `docs/01`–`09`, `docs/DECISIONS.md`.

### 2026-10-17 (lanjutan) — Fase 0
- VPS: SSH hardening aktif (password & root login mati; tes login password ditolak `Permission denied (publickey)`), ufw aktif (hanya 22/tcp), fail2ban jail sshd aktif. Catatan: sebelum hardening sudah ada ~1.100 percobaan brute-force di log sshd. swappiness 10, journald maks 1 GB. sshd Ubuntu 24.04 pakai socket activation (`ssh.socket`) → config baru berlaku untuk koneksi baru, tidak perlu reload.
- DB: PostgreSQL 17.11 + TimescaleDB 2.30.2, DB `memebot`, role rw/ro, password digenerate ke `/etc/memebot/secrets.env` (owner memebot) dan `.env` dev (gitignored, 600). Migrasi `0001_init` jalan; CAGG hierarkis 1m→5m teruji dengan data dummy; role ro tidak bisa insert.
- Repo: Bun workspaces, zod schema 4 config + loader + hot reload (config invalid ditolak, versi lama tetap dipakai) + versi config tercatat di DB, event bus typed, logger pino (redact secret), pool math constant product, `memebot-core` (control API 127.0.0.1:7071 dengan auth, kill switch file/API, heartbeat), dashboard shell (127.0.0.1:3000: health core+DB, system events), CLI `migrate` & `config:check`, unit systemd.
- Verifikasi: `bun test` 18 pass, `tsc` bersih, `biome check` bersih, smoke test core+dashboard+kill/resume+hot reload OK.
