# 03 — Arsitektur Sistem

## 1. Prinsip desain

1. **Deterministik di jalur panas.** Trigger → filter → security → sinyal → risk → eksekusi → exit = kode murni + config. LLM hanya di jalur lambat (async).
2. **Semua keputusan tercatat.** Setiap token yang dievaluasi punya jejak: data apa yang dilihat, rule mana yang lolos/gagal, `config_version` berapa. Tanpa ini tuning = tebak-tebakan.
3. **Paper dan live pakai pipeline yang sama.** Bedanya cuma modul executor (`paper` vs `live`). Jadi hasil paper bisa dibandingkan apel-ke-apel.
4. **Data dulu, strategi kemudian.** Collector + tracker jalan duluan (Fase 1), logika beli belakangan.
5. **Fail-safe.** Data basi / provider error / RPC lambat → **stop entry baru**, exit tetap jalan. Kill switch di 3 tempat (dashboard, Telegram, file flag).
6. **Hemat RAM.** VPS 2 vCPU / 2 GB → modular monolith, tanpa Docker/Redis/Grafana di awal.

## 2. Gambaran besar

```
                 ┌──────────────────────────── memebot-core (Bun, 1 proses) ────────────────────────────┐
 PumpPortal WS ─▶│ collectors/  ─▶ TokenTriggered ─▶ enrich/ ─▶ security/ ─▶ strategy/ ─▶ risk/ ─▶ exec/ │──▶ Jupiter V2 /
 DexScreener  ──▶│   (adapter per sumber,         (multi-provider   (authority,   (profiles,   (limits, (paper│    Pump SDK /
 GMGN         ──▶│    normalisasi + dedupe)        + null gate)      T22 ext,      MTF rules,   breakers) |live) │    Helius Sender
 Meteora      ──▶│                                                   honeypot sim) scoring)                     │
 Wallet stream ─▶│ market/ (tracker: trade stream + accountSubscribe pool → ticks → candles; quote lokal)       │
 Telegram     ──▶│ positions/ (exit engine: SL, ladder, trailing, time, event) ◀── harga real-time             │
                 │ journal/ (decisions, orders, fills, positions, shadow tracking)                              │
                 │ control/ (127.0.0.1:7071 HTTP+WS: event stream, perintah pause/kill/sell)                   │
                 └───────────────┬───────────────────────────────────────────────────┬───────────────────────┘
                                 │ SQL (Bun.sql)                                     │ WS internal
                       ┌─────────▼──────────┐                         ┌──────────────▼───────────────┐
                       │ PostgreSQL 17 +    │◀──── SQL ──────────────│ memebot-dashboard (Bun)       │◀── Browser (via Tailscale)
                       │ TimescaleDB        │                         │ Elysia API + React SPA + WS   │
                       └─────────▲──────────┘                         └──────────────▲───────────────┘
                                 │ job queue (SKIP LOCKED)                           │
                       ┌─────────┴──────────┐                         ┌──────────────┴───────────────┐
                       │ memebot-llm (Bun)  │── Anthropic API         │ notifier (di core): Telegram │
                       └────────────────────┘                         └──────────────────────────────┘
```

### Kenapa modular monolith untuk core?
- Event bus in-memory = latency mikrodetik (vs Redis pub/sub antar proses).
- RAM jauh lebih hemat (1 runtime Bun ~150–300 MB).
- Modul tetap terpisah per folder & interface, jadi nanti bisa dipecah jadi proses terpisah kalau VPS di-upgrade.
- LLM worker & dashboard **dipisah prosesnya** supaya crash/lambatnya nggak ganggu trading.

## 3. Modul core

| Modul | Tanggung jawab | Output event |
|---|---|---|
| `collectors/` | Adapter per sumber (PumpPortal, DexScreener, GMGN, Meteora, wallet, Telegram). Normalisasi → `{mint, source, kind, ts, payload}`. Dedupe per (mint, source) dengan TTL. Reconnect + backoff. | `TokenTriggered` |
| `market/` | Tracker harga per token aktif: subscribe trade stream / `accountSubscribe` vault pool / bonding curve. Hitung harga, mcap, likuiditas. Agregasi tick → candle 1s/15s di memori, flush ke DB. Indikator (VWAP anchored, EMA, RSI, ATR, volume z-score, buy/sell ratio, unique buyers/menit). **Quote lokal** dari reserve (constant product + fee). | `PriceTick`, `CandleClosed` |
| `enrich/` | Ambil data token dari provider (GMGN, Jupiter, Solana Tracker, RugCheck) paralel dengan timeout, cache, rate limiter per provider, **null gate**, cross-check field kritis. | `TokenEnriched` |
| `security/` | Mint/freeze authority (RPC `getAccountInfo` mint), parse Token-2022 extensions, LP status, simulasi jual (`simulateTransaction`), round-trip quote check, blacklist dev/funder. | `SecurityChecked` |
| `strategy/` | Evaluasi rule tiap profile (YAML), multi-timeframe check, scoring. Semua hasil (lolos/gagal + rule yang gagal + snapshot fitur) dicatat. | `Decision`, `Signal` |
| `risk/` | Cek limit global & per profile, daily stop, circuit breaker, jam trading, kill switch, saldo SOL minimal. | `OrderRequested` / `RiskRejected` |
| `exec/` | `paper` (simulasi realistis) & `live` (Jupiter V2 / Pump SDK / Sender). Konfirmasi, parse fill aktual dari tx meta, retry policy, close ATA. | `OrderSent`, `OrderFilled`, `OrderFailed` |
| `positions/` | State machine posisi, exit engine per tick, update MFE/MAE, trailing level. | `PositionOpened/Updated/Closed`, `ExitTriggered` |
| `journal/` | Tulis semua event ke DB (batch insert), shadow tracking token yang ditolak, hitung `tracked_paths`. | — |
| `control/` | API lokal untuk dashboard: stream event, status, perintah (pause/resume/kill/panic/sell manual/reload config). Auth shared secret. | — |
| `notifier/` | Telegram (grammY): notifikasi + perintah terbatas (chat ID whitelist). | — |

### State machine
```
Order:    CREATED → SENT → CONFIRMED | FAILED | EXPIRED
Position: PENDING_ENTRY → OPEN → (PARTIAL_EXIT)* → EXITING → CLOSED
                         └──────── ENTRY_FAILED
```

## 4. Tech stack

| Layer | Pilihan | Alasan |
|---|---|---|
| Runtime | **Bun 1.4.x** (sudah terpasang) + TypeScript strict | Cepat, satu bahasa untuk bot & dashboard, ekosistem Solana TS paling lengkap. |
| Solana | `@solana/kit` (web3.js v2) untuk kode baru; `@solana/web3.js` v1 kalau SDK pihak ketiga (pump SDK) butuh | Kit modular & cepat; v1 masih dipakai banyak SDK. |
| DB | **PostgreSQL 17 + TimescaleDB** (install native via apt) | Hypertable + kompresi + continuous aggregate untuk candle multi-TF; concurrent read dari dashboard. |
| DB client | `Bun.sql` (bawaan) + **Drizzle ORM** (`drizzle-orm/bun-sql`) + drizzle-kit migration (+ SQL mentah untuk hypertable) | Typed query, tanpa driver tambahan. |
| Validasi config | **zod** + YAML (`yaml` package) | Config bisa diedit tanpa sentuh kode, salah ketik ketahuan sebelum jalan. |
| Logging | **pino** (JSON) → journald | Cepat, terstruktur, bisa di-tail dari dashboard. |
| API dashboard | **Elysia** (Bun-native, validasi TypeBox, Swagger) | Paling cepat di Bun; alternatif: Hono. |
| Frontend | **React 19 + Tailwind v4 + shadcn/ui** dibundle oleh **Bun fullstack (HTML import)**, TanStack Query & Router | Tanpa Vite/webpack, HMR bawaan Bun. |
| Chart | **lightweight-charts v5** (candle + marker) + **ECharts** (heatmap, funnel, histogram) | Open source, ringan. |
| Realtime | WebSocket bawaan `Bun.serve` (topic pub/sub) | Tanpa socket.io. |
| Telegram | **grammY** (bot), **@mtcute/bun** (userbot KOL, Fase 6) | Jalan native di Bun. |
| LLM | `@anthropic-ai/sdk` (TypeScript) | Lihat `08-llm.md`. |
| Test | `bun test` | Unit test rule engine, exit engine, pool math, risk. |
| Proses | **systemd** unit per service (restart otomatis, limit memori) | Lebih ringan dari Docker/PM2. |
| Akses | **Tailscale** (dashboard hanya di IP tailnet) | Dashboard bisa kontrol wallet → jangan publik. |

## 5. Struktur repo (Bun workspaces)

```
memebot/
├─ apps/
│  ├─ core/                 # trading engine
│  │  └─ src/{collectors,market,enrich,security,strategy,risk,exec,positions,journal,control,notifier}/
│  ├─ dashboard/            # Elysia API + React SPA
│  │  └─ src/{server,api,web}/
│  ├─ llm-worker/           # job consumer Anthropic
│  └─ cli/                  # replay/backtest, maintenance (close ATA, export, dsb)
├─ packages/
│  ├─ shared/               # tipe event, zod config schema, util waktu/angka
│  ├─ db/                   # drizzle schema, migrations, query helper
│  └─ solana/               # rpc client, pool math, tx builder, token-2022 parser
├─ config/
│  ├─ strategy.example.yaml # profiles, filters, exits
│  ├─ trade.example.yaml    # risk & eksekusi
│  └─ sources.example.yaml  # collectors on/off, interval, endpoint
├─ infra/                   # systemd units, postgresql.conf tuning, backup script
├─ docs/
├─ .env.example             # tanpa nilai rahasia
└─ CLAUDE.md                # aturan kerja AI agent di repo ini
```

Rahasia (private key, API key) **di luar repo**: `/etc/memebot/secrets.env` (chmod 600, owner user service `memebot`).

## 6. Skema database (draft)

> `ht` = Timescale hypertable. Waktu selalu `timestamptz` UTC.

```sql
-- Master token
tokens(mint PK, symbol, name, decimals, program /*spl|token2022*/, launchpad, creator,
       created_at, migrated_at, pool_address, pool_kind, first_seen_at, first_source, metadata jsonb)

-- Trigger mentah dari collector
token_triggers(id, mint, source, kind, ts, payload jsonb)                      -- index (mint, ts)

-- Snapshot data provider
token_snapshots(id, mint, ts, provider, price_usd, mcap_usd, liquidity_usd, vol_5m, vol_1h,
                txns_5m, holders, top10_pct, dev_pct, bundler_pct, sniper_pct, insider_pct,
                fresh_wallet_pct, organic_score, smart_money_cnt, kol_cnt, raw jsonb)

security_reports(id, mint, ts, mint_authority, freeze_authority, extensions jsonb,
                 lp_status jsonb, sell_sim jsonb, roundtrip_loss_pct, rugcheck jsonb,
                 verdict /*pass|fail*/, reasons text[])

-- Setiap evaluasi (lolos maupun gagal)
decisions(id, mint, profile, ts, stage /*filter|security|mtf|score|risk*/, passed bool,
          failed_rules text[], features jsonb, score numeric, config_version int)

-- Data pasar
trades_raw  ht (ts, mint, slot, signature, side, sol_amount, token_amount, price_sol, trader, pool)  -- retensi 14 hari
ticks       ht (ts, mint, price_sol, price_usd, mcap_usd, liquidity_sol, source)                    -- retensi 30 hari, compress > 2 hari
candles_15s / candles_1m / candles_5m / candles_15m / candles_1h / candles_4h   -- continuous aggregates
            (bucket, mint, open, high, low, close, volume_sol, buy_vol_sol, sell_vol_sol, n_trades)

-- Statistik pasca-trigger (Trigger Lab) & shadow
tracked_paths(mint, source, profile_shadow, t0, entry_price_ref, ret_1m, ret_5m, ret_15m, ret_60m,
              max_ret, t_max_sec, min_ret, t_min_sec, rugged bool, was_rejected bool, reject_rules text[])

-- Trading
signals(id, mint, profile, ts, score, reasons jsonb, decision_id)
orders(id, client_id uniq, position_id, mode /*paper|live*/, side, requested_at, amount_in,
       quoted_out, slippage_bps, priority_fee_lamports, tip_lamports, router, status,
       signature, error, latency_ms)
fills(order_id, ts, amount_in, amount_out, exec_price, network_fee_sol, platform_fee, pool_fee_est,
      rent_delta_sol, quote_vs_fill_bps)
positions(id, mint, profile, mode, status, opened_at, closed_at, entry_price, size_sol, tokens_held,
          realized_pnl_sol, pnl_pct, mfe_pct, mae_pct, exit_reason, config_version, decision_id)
position_marks ht (ts, position_id, price, pnl_pct, exec_value_sol, trailing_stop_pct)

daily_stats(day, profile, mode, trades, wins, pnl_sol, fees_sol, max_dd_pct)

-- Config & kontrol
config_versions(id, created_at, author /*user|llm|system*/, kind, yaml text, diff text, note, active bool)
control_events(id, ts, actor, action /*pause|resume|kill|panic|sell|reload*/, payload jsonb)

-- Wallet
watch_wallets(address PK, label, source, active bool, score jsonb, added_at)
blacklist(address PK, kind /*dev|funder|token|cluster*/, reason, added_at)

-- LLM
llm_jobs(id, kind, status, priority, input jsonb, output jsonb, model, tokens_in, tokens_out,
         cost_usd, error, created_at, started_at, done_at)
llm_annotations(mint, kind, data jsonb, model, ts)

-- Observability
system_events ht (ts, level, service, kind, message, data jsonb)
api_usage     ht (ts, provider, endpoint, status, latency_ms)
```

Retensi & kompresi disetel supaya disk 40 GB aman (estimasi: 5–10k token/hari × tick 1–5 dtk × 1–2 jam tracking ≈ beberapa juta baris/hari → compress setelah 2 hari, drop setelah 30 hari; candle 1m+ disimpan lama).

## 7. Event types (packages/shared)

```ts
type Event =
  | { t: "TokenTriggered"; mint: string; source: Source; kind: string; ts: number; payload: unknown }
  | { t: "TokenEnriched"; mint: string; snapshot: TokenSnapshot; missing: string[] }
  | { t: "SecurityChecked"; mint: string; verdict: "pass" | "fail"; reasons: string[] }
  | { t: "Decision"; mint: string; profile: string; stage: Stage; passed: boolean; failed: string[]; score?: number }
  | { t: "Signal"; mint: string; profile: string; score: number }
  | { t: "OrderRequested" | "OrderSent" | "OrderFilled" | "OrderFailed"; order: OrderView }
  | { t: "PositionOpened" | "PositionUpdated" | "PositionClosed"; position: PositionView }
  | { t: "CircuitBreaker"; scope: "global" | string; reason: string; until?: number }
  | { t: "Heartbeat"; service: string; lagMs: number; mem: number };
```

## 8. Alur latency target (profil momentum)

| Langkah | Target |
|---|---|
| Trigger diterima → masuk antrian | < 50 ms |
| Enrichment paralel (cache hit / miss) | < 300 ms / < 1.5 s |
| Security (RPC + simulasi) | < 800 ms |
| Rule + MTF + risk | < 10 ms |
| Order → konfirmasi | 0.5 – 2 s |
| Tick harga → keputusan exit | < 100 ms |

Profil "sniper" butuh < 300 ms end-to-end — **tidak realistis di Fase 1–5**, makanya ditaruh paling akhir.

## 9. Keamanan

- Wallet trading = **hot wallet khusus**, saldo dibatasi (mis. maks 2× kebutuhan harian). Profit di-sweep berkala ke wallet dingin (manual/terjadwal).
- Private key hanya dibaca proses `memebot-core` (user Linux `memebot`), file `/etc/memebot/secrets.env` chmod 600.
- Claude Code / AI agent **tidak boleh membaca** file secret (deny rule di `.claude/settings.json`).
- Dashboard & control API bind ke `127.0.0.1` / IP Tailscale, login + konfirmasi untuk aksi berbahaya.
- Input dari dunia luar (nama token, deskripsi, pesan Telegram) = **data tak tepercaya**, terutama saat masuk prompt LLM.
- Dependency di-pin (`bun.lock`), audit sebelum menambah paket baru (banyak paket "solana bot" berisi drainer).
