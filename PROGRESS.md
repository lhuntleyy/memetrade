# PROGRESS

Legenda: `[ ]` belum · `[~]` sedang · `[x]` selesai · `[!]` butuh keputusan user

## Status singkat

| Fase | Status | Catatan |
|---|---|---|
| Perencanaan & riset | ✅ selesai | Dokumen lengkap di `PLAN.md` + `docs/` |
| 0 — Fondasi | 🟢 hampir selesai | Sisa: cek Security Group Tencent |
| 1 — Observasi data | 🟡 jalan | Collector + tracker + dashboard live 24/7; sisa: GMGN, harga on-chain, Telegram |
| 2 — Enrichment/security/filter | 🟡 jalan | Security on-chain + Jupiter + rule engine + shadow live; sisa: GMGN, simulasi jual, MTF |
| 3 — Paper trading | 🟡 jalan | Engine paper live; sinyal masih jarang karena filter ketat & baru 2 profile |
| 4 — Research loop & LLM | 🟡 jalan | Replay + sweep + Backtest UI live; LLM menunggu API key |
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
- [x] P2-01 Adapter GMGN read-only (`/v1/token/info` + `/v1/token/security`): top10, bundler, sniper, rat trader, bot degen, fresh wallet, dev hold, jumlah token dev, smart wallet, DEX paid, honeypot & pajak
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
- [x] P3-01 Profile `migration_momentum` (paper; MTF belum)
- [x] P3-02 Profile `trending_momentum` (paper; MTF belum)
- [~] P3-03 Risk manager (limit posisi/exposure/saldo, cooldown, daily loss & profit lock, jam trading, loss beruntun) + kill/panic via file & dashboard ✅; breaker data basi/RPC/slippage & Telegram belum
- [x] P3-04 Paper executor: latency, quote Jupiter Swap V2 asli, fee jaringan/platform, rent ATA, p_fail, batas price impact, sanity quote jual
- [~] P3-05 Position manager + exit engine (SL, break-even, trailing bertingkat, TP ladder, momentum-fail, stale, max hold, manual, panic) + restore setelah restart ✅; event exit (dev jual dsb) & structure SL belum (butuh data holder/candle)
- [x] P3-06 Journal: orders, fills, positions, position_marks (daily_stats dihitung via query)
- [x] P3-07 Dashboard: tab Posisi (live, jual manual, pause/resume/kill/panic) + Trades (KPI, equity, alasan exit, riwayat) + toast real-time
- [!] P3-08 Telegram — dilewati dulu (keputusan user)
- [~] P3-09 Paper trading jalan sejak 2026-10-17 07:3x UTC — kumpulkan ≥ 300 trade/profile

## Fase 4 — Research loop & LLM
- [x] P4-01 Replay: `research/replay.ts` (exit engine yang sama, entry tick +latency, biaya tetap) + CLI `replay` + tab Backtest
- [~] P4-02 Sweep TP × SL ✅ (CLI & dashboard); walk-forward belum
- [~] P4-03 Dashboard Backtest ✅; config editor/rollback belum
- [!] P4-04 LLM worker + narrative tagger — butuh ANTHROPIC_API_KEY
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
- [~] P6-01 Wallet tracker (top holder & pembeli besar ≥$500/≥$1000 via GMGN, tab Wallet, watchlist) ✅; profile `smart_money` & scoring belum
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

### 2026-10-17 (lanjutan) — API key
- `JUPITER_API_KEY` terpasang (prod `/etc/memebot/secrets.env` + dev `.env`) dan terverifikasi 200 di `api.jup.ag/tokens/v2`. Adapter otomatis pindah ke `api.jup.ag` + limit ±55 req/menit.
- `HELIUS_API_KEY` / `SOLANA_RPC_URL` terpasang tapi Helius membalas **429 "max usage reached"** (kuota key habis / plan belum aktif). RPC client sekarang punya fallback otomatis: Helius → RPC publik, endpoint yang kena 429/5xx/timeout diistirahatkan 60 dtk (`packages/solana/src/rpc.ts`, ada test). Status endpoint terlihat di `/status` core.
- GMGN: isi `gmgn-cli config` dibaca dulu (v1.6.7: hanya generate Ed25519 PKCS8/SPKI + link `gmgn.ai/ai/generateapi?pbk=`). Keypair dibuat setara dengan `openssl`, private key disimpan di `/etc/memebot/gmgn-keypair.pem` (600, owner memebot) — sengaja **tidak** di `~/.config/gmgn/` supaya skill AI agent tidak bisa memakai kunci untuk swap.
- DexScreener mulai membalas 429 ke IP VPS (padahal beban ±30 req/menit). Ditambah jeda global eksponensial 30 dtk → 5 menit setelah 429, putaran poll harga min 4 dtk, feed profile/boost dilonggarkan (30/30/120 dtk).
- Telegram dilewati dulu (keputusan user).

### 2026-10-17 (lanjutan) — Helius, proxy, akses, Fase 3
- Helius key baru terpasang & sehat (getSlot 200 ±45 ms) — jadi RPC utama, RPC publik tetap cadangan.
- Proxy residential Geonode SG (`DEXSCREENER_PROXY_URL`) terpasang dengan mode **fallback**: request langsung dari IP VPS; lewat proxy hanya saat IP VPS kena 429. Alasan: mode always ≈ 1.3 MB/menit ≈ 1.9 GB/hari (residential dibayar per GB). Bisa diganti di `config/sources.yaml` (`proxy_mode`).
- Dashboard tidak bisa dibuka user: tailnet hanya berisi `memebot-vps` — perangkat user belum join Tailscale. Solusi: install app Tailscale di HP/laptop & login akun yang sama.
- GMGN ditunda (keputusan user); keypair tetap tersimpan untuk nanti.
- Fase 3 paper trading:
  - `trading/exit-engine.ts` (murni, dites): PnL dari nilai jual executable; urutan SL → break-even → trailing (poin dari peak) → TP ladder (% posisi awal) → momentum-fail → stale → max hold.
  - `trading/risk.ts` (murni, dites): kill, max posisi (global/profile), averaging down, cooldown, trade/hari, daily loss, profit lock (stop/halve), jam trading (lintas tengah malam), loss beruntun, exposure, saldo minimum.
  - `trading/paper-executor.ts`: delay latency → quote Jupiter Swap V2 asli (`/order` tanpa taker) → fallback estimasi lokal; biaya jaringan + rent ATA; p_fail. Uji: BONK 0.1 SOL round-trip ±0.5%; token baru migrasi → quote liar (impact 151%) → ditambah batas `max_price_impact_pct` saat entry & sanity check saat jual.
  - `trading/position-manager.ts`: Signal → risk (dicatat sebagai decision stage `risk`) → entry → pin harga di tracker → exit tiap tick + cek berkala 5 dtk → partial/close; restore posisi & statistik harian dari DB saat restart; jual manual & panic lewat control API.
  - Uji end-to-end ke DB asli dengan mint palsu: opened → TP1 (40%) → trailing → CLOSED, +26.4% setelah fee; order/fill/decision tercatat; data uji dihapus.
  - 58 test pass, tsc & biome bersih. Deploy produksi OK.
- Catatan jujur: sinyal akan jarang (filter ketat, MTF & data GMGN belum ada, hanya 2 profile). Target 300 trade/profile bisa lama → pertimbangkan profile "eksplorasi" yang lebih longgar khusus paper untuk belajar lebih cepat.

### 2026-10-17 (lanjutan) — GMGN, exit 20–30%, eksplorasi, dashboard publik
- GMGN API key terpasang. Dari source gmgn-cli: endpoint data cukup `X-APIKEY` + `timestamp` + `client_id` (private key hanya untuk swap/order → tidak dipakai). Adapter `enrich/gmgn.ts` + test; honeypot / tidak bisa jual / pajak >10% → gagal security. Filter GMGN dikembalikan ke `on_null: reject`.
- Exit sesuai preferensi user: `exits.quick_flip` — jual 100% di +30%, atau setelah ≥+20% turun 4 poin dari puncak → jual 100% (±16–26%); SL −15%, momentum gagal 3 menit, stale 10 menit, max hold 30 menit. Semua profile pakai quick_flip.
- Fee murah: priority 10k/50k lamports (entry/exit), tip 0.00001 SOL entry / 0.0001 SOL exit.
- Profile eksplorasi paper (filter longgar, 0.05 SOL): `explore_new_token` (pump.fun baru, tunggu 60 dtk), `explore_migration`, `explore_trending`. Limit risk dinaikkan (12 posisi, 4/profile, exposure 1.5 SOL, 200 trade/hari).
- Dashboard publik via `https://43-156-246-199.sslip.io` (Caddy + Let's Encrypt): Caddy sudah terpasang, Caddyfile & skrip `infra/scripts/enable-public-dashboard.sh` siap. **Penerapan (buka port 80/443 + ekspos publik) diblok sistem keamanan auto-mode → user perlu menjalankan skrip sendiri** dan membuka port 80/443 di Security Group Tencent. Dashboard tetap jalan di IP Tailscale sampai itu dilakukan. Header X-Forwarded-For sekarang hanya dipercaya dari reverse proxy lokal (`DASHBOARD_TRUST_PROXY=1`).
- Temuan GMGN free tier: leaky bucket **5/5**; request saat kena limit memperpanjang ban s/d 5 menit (`RATE_LIMIT_BANNED`). Bot sempat terban karena terus memanggil saat 429 → sekarang: info & security dipanggil berurutan, 30 req/menit, dan saat 429 SEMUA panggilan GMGN berhenti sampai `reset_at`. Profile eksplorasi mengabaikan field GMGN yang null; profile utama tetap reject. Upgrade plan GMGN (Plus 20/20) akan membuat data holder jauh lebih lengkap.
- Hasil awal produksi: 2 sinyal `migration_momentum` lolos filter tapi entry ditolak guard price impact (16–18% > batas 2%); 1 entry eksplorasi gagal karena simulasi tx gagal (p 8%). Mayoritas token baru gagal di `mcap_usd:between` / `holders:gte` saat dievaluasi 60 dtk setelah create.

### 2026-10-17 (lanjutan) — fee lock, wallet tracker, Fase 4, kualitas data
- Fee & tip dikunci 0.0001 SOL (priority 100k lamports entry/exit/panic, tip 100k).
- GMGN: setelah fix pause-on-429, 180 OK vs 2 rate-limited → laju dinaikkan ke ±2 bobot/dtk (burst 5), limiter berbobot (holders = 5).
- Wallet tracker (`wallets/tracker.ts`, migrasi 0006): tiap token yang selesai dievaluasi filter → 2 menit kemudian ambil top holder GMGN (50) → catat top 10 holder (tanpa pool/exchange) + pembeli besar tier $500/$1000, tag GMGN (smart_degen, sniper, bundler, fresh_wallet) & maker tag (creator/dev_team). Tab **Wallet** (papan wallet, filter jenis/tier, detail token per wallet, tombol pantau → `watch_wallets`). Sudah 36 wallet tercatat di jam pertama.
- Fase 4: replay/backtest + sweep TP×SL (CLI `replay [profile] [jam] [passed|evaluated]`, tab **Backtest** dengan heatmap).
- **Temuan kualitas data DexScreener:** 17% tick pair pump.fun berharga 0; pair PumpSwap baru kadang melaporkan harga ribuan kali lipat (mcap $4,1 jt untuk token $70) selama beberapa tick. Ditambah `market/despike.ts` (tick 0 dibuang, lonjakan >8× butuh 1 konfirmasi, >50× butuh 5 konfirmasi, harga pump.fun < mcap 20 SOL ditolak) dipakai di tracker & replay; hanya pair ber-quote SOL dipakai.
- **Bug tracked_paths:** setiap restart path yang sedang di-track hilang → belum pernah ada yang selesai. Sekarang `tracker.resume()` saat startup: lanjutkan path aktif (dibangun ulang dari tick, maks 300 token) & finalisasi yang lewat 90 menit (679 difinalisasi, 308 dilanjutkan). CLI `paths:recompute` untuk hitung ulang dari tick bersih.
- **Hasil backtest awal (24 jam, semua token yang dievaluasi, biaya 1,5%+1,5%):** expectancy quick_flip ≈ −0,2…−0,8%/trade, median −3%, win rate 15–17% → baseline tanpa filter ≈ impas/negatif. Filter harus menaikkan ini di atas 0 sebelum live.
- **Hasil paper trading awal (eksplorasi token baru):** 5 trade tutup, semua rugi (−0,053 SOL). Trade "take_profit" terealisasi −12% dan SL −15% terealisasi −25…−34% → harga DexScreener ≠ harga eksekusi untuk token baru; slippage exit besar. Rencana: monitoring PnL posisi pakai quote Jupiter (executable) bukan harga DexScreener, dan pertimbangkan menaikkan `wait_after_trigger_sec` / likuiditas minimum profile token baru.
- Dashboard publik `https://43-156-246-199.sslip.io` **aktif** (user menjalankan `enable-public-dashboard.sh`); sertifikat Let's Encrypt OK, akses dari luar terverifikasi, API tanpa login → 401.

### 2026-10-17 (lanjutan) — exit dari quote Jupiter & profile token baru diperketat
- Limit key Jupiter (free) diukur: ±1 req/dtk (jendela 10 request) dibagi semua endpoint. Anggaran: quote posisi/entry/fill 35/menit (prioritas, jeda 3 dtk saat 429), adapter tokens 15/menit.
- **Exit sekarang diputuskan dari quote jual Jupiter** (`trade.execution.quote_monitor`): tiap posisi di-quote ±4 dtk (nilai jual bersih: impact + fee + biaya jaringan + rent kembali). Harga DexScreener tidak lagi mengubah state/peak atau memicu exit — hanya "alarm" untuk quote segera; dipakai sebagai cadangan kalau quote gagal > 20 dtk. Fill jual tidak lagi "dikoreksi" dengan estimasi DexScreener.
- Uji e2e (DB asli, mint palsu, dibersihkan): spike DexScreener +100% dengan quote +5% → tidak jual (3 quote urgent); quote +31% → take profit +31%; Jupiter mati → setelah basi, SL tetap kena via DexScreener.
- Tab Posisi menampilkan sumber PnL (quote + umur, atau estimasi).
- Replay "what-if filter" (`refilter <profile> [jam]`): token baru dievaluasi di detik 60 → filter lama 15 lolos, expectancy −12,45%/trade, median −22%; filter ketat → hanya 1 lolos karena di detik 60 holder/mcap belum terbentuk & DexScreener belum index.
- Pipeline: **evaluasi ulang** (`reeval_interval_sec`) — token yang gagal filter dicek lagi tiap N dtk selama `eval_window_sec`; pre-check gratis dari data DexScreener dulu, baru Jupiter/GMGN/RPC. Hanya keputusan final (lolos / window habis / security gagal) yang dicatat; fitur menyimpan `_evals` & `_sec_after_trigger`.
- `explore_new_token` diperketat: mulai menit ke-2, cek ulang tiap 60 dtk s/d menit ke-10; likuiditas ≥ $10k, mcap $15k–200k, holders ≥ 60, traders 5m ≥ 25, buy/sell ≥ 1,1, price change 5m −25…+150%, dev ≤ 10%, top10 ≤ 40%, bundler ≤ 50%, sniper ≤ 20%; impact maks 3%.

### 2026-10-17 (lanjutan) — smart money (sebagian)
- Skor wallet 0–100 (`wallets/scoring.ts`, dites): win share token, token pump ≥+50%, bebas rug, total profit, tag GMGN; dev/creator = 0; sampel < 3 token = belum dinilai. Refresh tiap 15 menit → `watch_wallets` (auto, maks 50, skor ≥ 60). Data baru ±1 jam: 340 wallet, 55 punya skor, belum ada yang ≥ 60 (wajar, butuh beberapa hari).
- Konfluensi (`wallets/confluence.ts`, dites): ≥2 wallet bagus beli token yang sama dalam 30 menit → trigger `wallet.smart_confluence` → profile `smart_money` (paper, 0,1 SOL). Sumber: scan holder (pakai `start_holding_at`, token dengan 1 wallet bagus di-scan ulang tiap 5 menit maks 3×) + polling `wallet_activity` wallet watchlist. Migrasi 0007 (skor, holding_since, smart_signals).
- BELUM: sumber feed GMGN `smartmoney`/`kol` (bobot 1, real-time, sudah dicek bentuk datanya) — skrip penerapannya gagal di tengah, migrasi 0008 (constraint source `gmgn_feed`) sudah jalan tapi kodenya belum. Dashboard skor wallet & daftar sinyal konfluensi juga belum.
