# PROGRESS

Legenda: `[ ]` belum · `[~]` sedang · `[x]` selesai · `[!]` butuh keputusan user

## Status singkat

| Fase | Status | Catatan |
|---|---|---|
| Perencanaan & riset | ✅ selesai | Dokumen lengkap di `PLAN.md` + `docs/` |
| 0 — Fondasi | 🟢 hampir selesai | Sisa: cek Security Group Tencent |
| 1 — Observasi data | 🟡 jalan | Collector + tracker + dashboard live 24/7; sisa: GMGN, harga on-chain, Telegram |
| 2 — Enrichment/security/filter | 🟡 jalan | Security on-chain + Jupiter + rule engine + shadow live; sisa: GMGN, simulasi jual, MTF |
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
- [x] P0-11 Tailscale: node `memebot-vps` (100.112.11.86), dashboard bind ke IP tailnet + ufw allow port 3000 hanya di `tailscale0`

### Repo
- [x] P0-12 git + remote `lhuntleyy/memetrade` (deploy key write), push `main`
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
- [x] P1-01 Collector PumpPortal (new token + migration), 1 koneksi, reconnect + backoff
- [x] P1-02 Collector DexScreener (profiles, boosts latest/top) + rate limiter
- [!] P1-03 Collector GMGN (trending, trenches, hot) — butuh API key + whitelist IP
- [ ] P1-04 Collector Meteora (opsional)
- [x] P1-05 Dedupe & normalisasi trigger → `token_triggers`, `tokens`
- [~] P1-06 Pool math: harga bonding curve (virtual reserve) + constant product ✅; parser akun on-chain bonding curve/PumpSwap belum (butuh RPC)
- [~] P1-07 Market tracker 90 menit/token via polling DexScreener (≤30 mint/req, ±2 dtk/putaran) ✅; sumber real-time on-chain (accountSubscribe) belum — **butuh HELIUS_API_KEY**
- [~] P1-08 Tick → DB (`ticks`) ✅; candle CAGG 15s..4h siap tapi butuh `trades_raw` (trade stream) — belum ada sumber trade gratis
- [x] P1-09 Hitung `tracked_paths` (ret, max/min, waktu, rugged)
- [x] P1-10 Dashboard: Bun.serve + vanilla TS (Elysia/React ditunda, ADR-011) + login password (Argon2, cookie HMAC, throttle 5x/15 menit)
- [x] P1-11 Dashboard: Overview (health), Live Feed
- [x] P1-12 Dashboard: Trigger Lab (stat per sumber, heatmap jam)
- [ ] P1-13 Telegram notifier dasar
- [~] P1-14 Observasi jalan 24/7 sejak 2026-10-17 05:33 UTC (systemd `memebot-core` + `memebot-dashboard`); laporan setelah ≥ 7 hari

## Fase 2 — Enrichment, security, filter
- [!] P2-01 Provider adapter GMGN (token info/security/holders, created-tokens) — butuh GMGN_API_KEY
- [x] P2-02 Provider adapter Jupiter Tokens v2 (holders, organic score, dev %, dev mints, traders/net buyers 5m) — keyless ±25 req/menit
- [ ] P2-03 Provider Solana Tracker / RugCheck (cross-check, opsional)
- [~] P2-04 Rate limiter, cache (security 10 menit, Jupiter 60 dtk), timeout, null gate ✅; cross-check 2 provider belum (butuh GMGN/Solana Tracker)
- [x] P2-05 Security: authority + Token-2022 extension (RPC jsonParsed) — tervalidasi dengan mint pump.fun asli
- [ ] P2-06 Security: simulasi jual + round-trip quote + blacklist (butuh Jupiter quote/ RPC privat)
- [~] P2-07 Rule engine YAML + decision log (security & filter) ✅; MTF & scoring belum (butuh candle dari trade stream)
- [x] P2-08 Shadow: semua token yang dievaluasi tetap di-track; decisions ↔ tracked_paths via (mint, trigger_source, trigger_ts) — migrasi 0003
- [x] P2-09 Dashboard: tab Pipeline (funnel, alasan ditolak, efektivitas filter) + Token Explorer (info, security, sparkline harga, jalur per trigger, keputusan, fitur)
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

### 2026-10-17 (lanjutan) — Fase 1
- Commit Fase 0 `b07b48f` (lokal). Remote `origin` = `git@github-memetrade:lhuntleyy/memetrade.git` pakai deploy key `~/.ssh/memetrade_deploy` — **user perlu tambah deploy key (write) di GitHub** sebelum push.
- Collector: PumpPortal (new token + migration, 1 koneksi, reconnect + watchdog sunyi 2 menit) dan DexScreener (profiles/boosts latest/top, dedupe 6 jam, putaran pertama ditandai `backlog` dan tidak di-track).
- Market tracker: polling DexScreener `/tokens/v1` untuk semua token aktif, simpan `ticks`, hitung `tracked_paths` (ret 1/5/15/60m, max/min, rugged).
- **Temuan metodologi:** awalnya referensi return = harga create dari virtual reserve → max return rata-rata +3.000% (tidak realistis, itu harga dev). Diganti: referensi = harga **pasar pertama yang teramati**, harga trigger disimpan terpisah + `ref_delay_sec` (migrasi `0002`).
- **Temuan latency:** DexScreener baru meng-index token pump.fun baru median **±53 detik** setelah create → stat `pumpportal.new_token` = "kalau masuk ±1 menit setelah launch". Untuk entry lebih awal perlu harga on-chain bonding curve (Helius/RPC).
- Dashboard: tab Overview (status core, collector, tracker), Live Feed (real-time via relay WS core → dashboard → browser; nama token di-escape anti-XSS), Trigger Lab (per sumber: hit +20/+50/+100%, rug rate, median max/return/menit ke puncak/delay harga; distribusi max return; heatmap jam WIB).
- Deploy: `/opt/memebot/app` (rsync dari repo), Bun untuk user `memebot`, unit `memebot-core` & `memebot-dashboard` aktif + enable on boot. Port dev dipindah ke 7072/3001 (`.env`) supaya tidak bentrok dengan prod 7071/3000.
- Verifikasi: 30 test pass, tsc & biome bersih, smoke test live (PumpPortal ±12 token baru/menit, DexScreener 200 OK ±83 ms), relay WS terkirim. **Belum dicek visual di browser** (dashboard hanya 127.0.0.1 sampai Tailscale terpasang; sementara bisa via SSH tunnel `ssh -L 3000:127.0.0.1:3000 ubuntu@<ip-vps>`).
- Belum: collector GMGN (butuh API key + whitelist IP), Meteora, notifier Telegram (butuh bot token), harga on-chain (butuh Helius key), login dashboard.

### 2026-10-17 (lanjutan) — akses dashboard & Fase 2
- Push ke GitHub `lhuntleyy/memetrade` berhasil (deploy key).
- Akses dashboard: Tailscale terpasang (`memebot-vps`, 100.112.11.86). `tailscale serve` butuh fitur Serve/HTTPS diaktifkan di admin tailnet → sebagai gantinya dashboard bind langsung ke IP tailnet (drop-in `infra/systemd/memebot-dashboard.service.d/tailscale.conf`), ufw buka 3000 hanya di `tailscale0`. URL: `http://100.112.11.86:3000` (perangkat harus login Tailscale yang sama). Password: `sudo cat /etc/memebot/dashboard-password.txt`.
- Login dashboard: semua `/api/*` dan `/ws` butuh session; dites (401 tanpa login, salah → error, benar → 200).
- Fase 2: pipeline trigger → tunggu `wait_after_trigger_sec` → (tunggu pair DexScreener s/d 4×20 dtk) → Jupiter + DexScreener → security on-chain → filter → `decisions` (+ event Decision/Signal). Belum ada entry.
- Temuan: Jupiter Tokens v2 meng-index token pump.fun baru jauh lebih cepat dari DexScreener (holderCount, harga, stats 5m sudah ada beberapa detik setelah create) → kandidat sumber harga awal (tapi keyless cuma ±0.5 RPS; butuh JUPITER_API_KEY untuk volume).
- Config strategy disesuaikan dengan data yang ada: field GMGN (`top10_pct`, `bundler_pct`, `sniper_pct`, `dev_rug_ratio`) sementara `on_null: ignore`; `unique_buyers_1m`→`traders_5m`, `buy_sell_ratio_1m`→`buy_sell_ratio_5m`; critical fields = likuiditas & mcap.
- `token_snapshots` belum ditulis terpisah — snapshot fitur disimpan di `decisions.features` (tahap filter).
