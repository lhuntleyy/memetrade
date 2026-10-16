# 06 — Web Monitoring Dashboard

## 1. Tujuan
1. Lihat **kondisi bot real-time** (posisi, PnL, health) dari HP/laptop.
2. Jadi **lab riset**: statistik sumber trigger, efektivitas filter, hasil replay.
3. **Kontrol aman**: pause/kill/panic, jual manual, ganti config (dengan validasi & versioning).

## 2. Stack
- **Bun** `Bun.serve` fullstack: route API + WebSocket + HTML import (SPA dibundle Bun, HMR saat dev).
- **Elysia** untuk API (validasi TypeBox, Swagger di `/api/docs`) — di-mount ke `Bun.serve`.
- **React 19 + Tailwind v4 + shadcn/ui**, TanStack Query (cache data), TanStack Router.
- **lightweight-charts v5** (candle + marker entry/exit + garis SL/TP/trailing), **ECharts** (heatmap, funnel, histogram, equity curve).
- Data: query read-only ke Postgres (role `memebot_ro`) + stream event dari core (`127.0.0.1:7071/ws`) yang di-fan-out ke browser via WS topic.
- Dark mode default, responsive (bisa dipantau dari HP).

## 3. Halaman

### 3.1 Overview
- Badge mode **PAPER / LIVE**, status tiap profile, tombol **Pause / Kill / Panic** (konfirmasi + TOTP untuk panic & live).
- KPI hari ini & all-time: realized PnL (SOL & USD), unrealized, win rate, profit factor, expectancy/trade, avg win / avg loss, jumlah trade, fee dibayar, max drawdown.
- Equity curve (1D/7D/30D/All) per mode/profile.
- Progress bar limit harian (loss terpakai %, trade count, exposure).
- Lampu health service (core, dashboard, llm-worker, DB, RPC, provider).

### 3.2 Live Feed & Pipeline
- Stream real-time token masuk: sumber, mint/simbol, status chip (`REJECTED: top10_pct` / `SECURITY_FAIL: freeze_auth` / `SIGNAL` / `ENTERED`).
- **Funnel** per sumber: trigger → lolos filter → lolos security → lolos MTF → lolos risk → entry.
- Top alasan penolakan (1 jam / 24 jam).

### 3.3 Positions
- Tabel live: token, profile, entry, harga sekarang, PnL% & SOL, MFE/MAE, level trailing, TP berikutnya, umur posisi, nilai jual executable.
- Mini chart per posisi dengan garis entry/SL/TP/trailing.
- Aksi: jual 25/50/100%, geser SL, matikan trailing (tercatat di `control_events`).

### 3.4 Trades (Journal)
- Riwayat dengan filter (profile, sumber, tanggal, hasil, exit reason), export CSV.
- Detail trade: chart multi-TF (15s/1m/5m/15m/1h) + marker entry/exit, snapshot fitur & filter saat entry, laporan security, quote vs fill, fee breakdown, link Solscan, tag LLM, catatan manual.

### 3.5 Token Explorer
- Cari mint → semua data: info, security, distribusi holder, riwayat dev, candle multi-TF, **log semua keputusan** untuk token ini (kapan dievaluasi, rule apa yang gagal), hasil shadow.

### 3.6 Trigger Lab (analitik riset)
- Per sumber: jumlah token, % yang menyentuh +20/+50/+100% dalam 5/15/60 menit, median waktu ke puncak, rug rate (−80% dalam 1 jam), distribusi max return.
- **Heatmap jam (UTC/WIB) × hari** untuk performa sumber & profile.
- **Filter effectiveness** (dari shadow): per rule → winner yang dibuang vs loser yang dicegah.
- Analisa bucket fitur (mis. top10% 0–15 / 15–25 / 25–35 vs hasil).

### 3.7 Backtest / Replay
- Jalankan replay config varian pada rentang tanggal → equity curve, metrik, perbandingan dengan config aktif.
- Hasil parameter sweep (heatmap TP × SL, trailing distance × activation).
- Walk-forward: hasil in-sample vs out-of-sample.

### 3.8 Strategy & Config
- Daftar profile (off/paper/live), edit YAML dengan validasi schema (error ditampilkan per baris), **diff** vs versi aktif, riwayat versi + rollback.
- Perubahan dari LLM muncul sebagai "proposal" yang wajib lolos replay + approve manual.

### 3.9 Wallets
- Saldo hot wallet, SOL reserve, token account terbuka (rent yang bisa diklaim → tombol close ATA).
- Watchlist smart wallet + skor + aktivitas terbaru; blacklist dev/funder/cluster.

### 3.10 System
- Status service + heartbeat + event lag, RAM/CPU/disk VPS.
- Pemakaian & error rate per provider API (kuota Jupiter/Helius/GMGN), latency RPC p50/p95, status koneksi WS.
- Log tail (filter level/service), riwayat alert & circuit breaker.

### 3.11 AI Insights
- Laporan review harian/mingguan dari LLM, proposal perubahan config, statistik narrative, biaya LLM.

## 4. API (draft)

| Method | Path | Isi |
|---|---|---|
| GET | `/api/overview` | KPI, mode, health ringkas |
| GET | `/api/positions` | posisi terbuka |
| POST | `/api/positions/:id/sell` | `{ pct }` jual manual |
| GET | `/api/trades` | query riwayat (filter, paging) |
| GET | `/api/trades/:id` | detail trade + fills + snapshot |
| GET | `/api/tokens/:mint` | data token + security + keputusan |
| GET | `/api/tokens/:mint/candles?tf=1m&from&to` | OHLCV |
| GET | `/api/pipeline/stats?window=1h` | funnel & reject reasons |
| GET | `/api/lab/sources` · `/api/lab/filters` · `/api/lab/heatmap` | analitik |
| POST | `/api/replay` · GET `/api/replay/:id` | jalankan & lihat replay |
| GET/PUT | `/api/config/:kind` | baca / simpan config (validasi + versi) |
| POST | `/api/control/{pause,resume,kill,panic,reload}` | kontrol (TOTP untuk panic/live) |
| GET | `/api/system/health` · `/api/system/logs` | observability |
| WS | `/ws` topic: `feed`, `decisions`, `positions`, `trades`, `health`, `logs`, `alerts` | real-time |

## 5. Akses & keamanan
- Dashboard bind ke `127.0.0.1:3000`; akses dari luar lewat **Tailscale** (IP tailnet) — tanpa port publik. Alternatif: Cloudflare Tunnel + Cloudflare Access.
- Login password (hash `Bun.password`) + session cookie httpOnly; **TOTP** untuk aksi berbahaya (panic, ganti ke live, edit config live).
- Role DB read-only untuk query analitik; perintah kontrol hanya lewat control API core.
- Rate limit login, audit log semua aksi.

## 6. Notifikasi Telegram (bagian dari "monitoring")
- Bot grammY, hanya merespons chat ID admin.
- Push: entry/exit (ringkas), ringkasan harian (00:00 UTC & jam pilihan WIB), circuit breaker, error eksekusi, saldo rendah, service restart.
- Perintah: `/status`, `/positions`, `/pnl [today|7d]`, `/pause [profile]`, `/resume`, `/kill`, `/panic` (konfirmasi 2 langkah).

## 7. Opsional nanti (kalau RAM di-upgrade ≥ 4 GB)
- **Grafana** baca langsung ke Postgres/Timescale untuk ad-hoc chart & alert rule.
- **Uptime Kuma** untuk cek endpoint health dari luar.
- **Netdata** untuk metrik sistem detail.
