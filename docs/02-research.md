# 02 — Riset Referensi: Data, Eksekusi, Infra, Strategi

> Dikumpulkan 2026-10-17. Harga & limit provider sering berubah — **cek ulang di dashboard masing-masing sebelum bayar/pakai**. Kolom "Keyakinan" = seberapa yakin datanya akurat (Tinggi = dari docs resmi; Sedang = docs resmi tapi ada konflik; Rendah = sumber pihak ketiga).

## 1. Sumber trigger (token masuk pipeline)

| Sumber | Apa yang didapat | Biaya / limit | Latency | Keyakinan | Dipakai di fase |
|---|---|---|---|---|---|
| **PumpPortal WS** `wss://pumpportal.fun/api/data` | `subscribeNewToken`, `subscribeMigration` (gratis); `subscribeTokenTrade`, `subscribeAccountTrade` (0.01 SOL / 10.000 event, butuh API key + wallet ≥ 0.02 SOL) | Gratis/metered. **Wajib 1 koneksi saja**, buka banyak koneksi = ban 1 jam | Real-time | Tinggi | 1 |
| **DexScreener API** | `token-profiles/latest/v1` (token yang bayar profile), `token-boosts/latest|top/v1`, pair data `/tokens/v1/solana/{mints}` (≤30 mint/call) | Gratis, tanpa key. ~60 rpm profile/boost, ~300 rpm pairs | Polling 5–30 dtk | Sedang | 1 |
| **GMGN OpenAPI / gmgn-cli** | `market trending`, `market trenches` (launch baru), `market signal` (smart money, large buy), `hot-searches`, `track smartmoney/kol` | Free tier dengan API key + Ed25519, IP whitelist, IPv4. Leaky bucket ~10–20 rps berbobot | Polling | Sedang | 1–2 |
| **Meteora** DAMM v2 `damm-v2.datapi.meteora.ag/pools`, DLMM `dlmm.datapi.meteora.ag` | Pool list (cek sort by created/volume di Swagger) | 10 rps (DAMM v2), ~30 rps (DLMM) | Polling | Sedang | 2 |
| **Smart wallet tracking** | Swap dari wallet pilihan via PumpPortal `subscribeAccountTrade`, Helius `logsSubscribe`/enhanced WS, atau gRPC | Metered / plan RPC | Real-time | Tinggi | 3–6 |
| **Telegram channel (KOL call)** | Userbot MTProto pakai `@mtcute/bun` (alpha, pin versi) → regex CA base58 + LLM parser | Gratis (akun Telegram) | Real-time | Sedang | 6 |
| **X (Twitter)** | API resmi berbayar; alternatif pihak ketiga | Mahal | — | — | Nanti / opsional |
| **Jupiter Tokens API v2** | Daftar token + `organicScore` (0–100, filter wash trading) + `audit` (`mintAuthorityDisabled`, `isSus`, dll) | Key gratis 1 RPS | Polling | Sedang | 2 |

## 2. Provider data token (enrichment & filter)

| Provider | Kelebihan | Harga | Catatan |
|---|---|---|---|
| **GMGN** | Bundler/rat trader exposure, rug ratio, smart money & KOL holders, dev created-tokens, security (honeypot) | Free tier (key) | Field paling "degen-native". IPv4 only. |
| **Solana Tracker Data API** | 70+ endpoint: token, holders, risk score, OHLCV, PnL, Datastream WS (snipers/insiders, top10, dev holdings) | Free 10k req/bln (3 rps) · Advanced €50 (200k) · Pro €200 (1M) · Premium €397 (Datastream) | Post: kadang data null/0 → wajib null-gate. Landing page sebut free 2.5k/bln (konflik). |
| **Mobula** | Menurut penulis post paling akurat | Berbayar | Opsional kalau budget ada. |
| **Jupiter** Tokens v2 / Price v3 | Organic score, audit, harga | Free 1 RPS; paid lebih tinggi | `lite-api.jup.ag` masih jalan saat dicek (2026-10-17) tapi status deprecated → pakai `api.jup.ag` + key. |
| **Birdeye** | OHLCV, WS harga/tx/new listing (Business), mcap chart mode (Agu 2026) | Free 30k CU/bln 1 rps; WS mulai paket mahal | Opsional. |
| **GeckoTerminal** | OHLCV pool gratis (backfill swing) | Gratis 30 call/menit, tanpa auth | Bagus buat timeframe 15m–4h. |
| **RugCheck** | Report risiko token (`api.rugcheck.xyz`, Swagger) | Butuh key, ada rate limit | Cross-check security. |

**Keputusan awal:** GMGN (utama untuk distribusi holder & dev) + Jupiter (organic score/audit) + data on-chain kita sendiri (authority, extensions, reserve pool, trade stream) + Solana Tracker/RugCheck sebagai **cross-check** field kritis. Mobula/Birdeye opsional.

## 3. RPC, streaming, & pengiriman transaksi

| Layanan | Paket relevan | Catatan |
|---|---|---|
| **Helius** | Free: 1M credit, 10 RPS · **Developer $49: 10M credit, 50 RPS, LaserStream WSS (enhanced)** · Business $499: LaserStream gRPC mainnet | Ada region **Singapore**. Fase 1–3 cukup Free/Developer. |
| **Helius Sender** | Endpoint regional: `http://sg-sender.helius-rpc.com/fast` (+ `?swqos_only=true` tip min **0.000005 SOL**; mode dual/Max tip min 0.001 SOL); `mev-protect=true` hindari validator sandwich | Pernah ada insiden SG Juli 2026 (power outage) → siapkan fallback region (Tokyo). |
| **Yellowstone gRPC** (murah) | Chainstack add-on **$49/bln (2 stream)**, $149 (7 stream) · Solana Tracker standalone **€200/bln (25 koneksi)** · Helius LaserStream ($499+) | Upgrade saat butuh real-time banyak token sekaligus (Fase 6). |
| **Jito** | Bundle + tip, block engine regional (Tokyo dll) | Region Singapore belum terkonfirmasi. Via Sender sudah ada dual routing. |
| **Solana public RPC** | `api.mainnet-beta.solana.com` (~45 ms dari VPS) | Jangan dipakai produksi (rate limit ketat). |

**Insight teknis penting:** harga posisi bisa didapat **tanpa bayar gRPC** dengan `accountSubscribe` (WebSocket RPC standar) ke akun vault pool / bonding curve → hitung harga & nilai jual dari reserve secara lokal. Jupiter cuma dipanggil saat eksekusi (karena free tier 1 RPS).

## 4. Eksekusi swap

| Jalur | Kapan dipakai | Fee | Catatan |
|---|---|---|---|
| **Jupiter Swap API V2 `/order` + `/execute`** (`https://api.jup.ag/swap/v2`) | Default, token post-migrasi | Platform fee **0 bps** (Jupiter/pegged), **10 bps** umum, **50 bps token < 24 jam** | RTSE slippage otomatis (isi `slippageBps` → mode manual, routing bisa lebih terbatas). `/execute` limit: keyless 20, free 50, paid 100 RPS. Ultra V1 **deprecated**. |
| **Jupiter `/build`** | Mau kontrol penuh priority fee/tip & kirim lewat Sender sendiri | Cek docs (fee bisa beda dari `/order`) | Router on-chain diganti nama iris → **metis** (Mei 2026). |
| **Pump.fun / PumpSwap langsung** (SDK resmi pump) | Token masih di bonding curve; jalur cepat; **fallback exit** kalau Jupiter error | Fee protokol saja | Bonding curve penuh di ~85 SOL; migrasi instan ke PumpSwap (tanpa fee migrasi). Fee PumpSwap base 0.25% + creator fee dinamis (sumber sekunder: 0.95% di mcap $88k–300k, turun s/d 0.05% di $20M+) — **verifikasi**. |
| **PumpPortal trading API** | Prototipe cepat | Ada fee layanan | Opsional. |
| **GMGN swap / strategy order** | Alternatif (TP/SL & trailing server-side GMGN) | Cek GMGN | Butuh Ed25519 + IP whitelist. Bisa jadi "backup exit" kalau bot mati. |

## 5. Lanskap memecoin Solana 2026 (konteks strategi)

- **Pump.fun masih dominan** secara revenue (Sep 2026, pendapatan launchpad Pump.fun >100× Bonk.fun menurut Phemex); LetsBonk sempat menyalip volume di 2025. Meteora DBC & Bags punya porsi kecil. → Collector harus **modular per launchpad**.
- **Graduation rate pump.fun ±0.8%** rata-rata 2026 (puncak 2.01% minggu 9–15 Mar 2026) — sumber tunggal, perlu konfirmasi di Dune. Artinya ~99% token baru mati di bonding curve → sniping buta = bakar uang.
- Laporan Solidus Labs: hampir semua launch pump.fun = pump-and-dump/rug. BlockEden 2026: ~98.6% abandoned/rugged.
- Riset akademik: **"Coordinated Sniper Cohorts on Pump.fun"** (arXiv 2607.02795) — 1.012 ring wallet sniper persisten yang muncul di first buyers banyak launch. → **fitur filter**: deteksi wallet ring di first buyers + blacklist cluster.
- Serial deployer analysis (Substack killy7) — dev yang launch puluhan token. → **dev reputation** wajib.
- Token-2022: permanent delegate, transfer fee max, freeze, default frozen, transfer hook = vektor scam. Raydium CPMM/CLMM menolak mint dengan permanent delegate.

## 6. Bot & tool open-source (referensi kode, bukan untuk dipakai mentah)

| Repo | Isi | Catatan |
|---|---|---|
| `GMGNAI/gmgn-skills` | 15 skill AI agent + `gmgn-cli` | Referensi API GMGN. |
| `GMGNAI/skillmarket-demos` (aitrader, memex) | Screening + LLM explain + wallet eval | Pola pipeline & dev reputation. |
| `muxprotocol/solana-trading-bot` | TS sniper Raydium + pump.fun, TP/SL | Push terakhir Apr 2026. |
| `bitman09/pumpfun-sniper-bot` | TS, Geyser WS, TP/SL/timeout | Referensi stream. |
| `roswelly/pumpfun-buy-sell` | Library buy/sell bonding curve | Referensi math curve. |
| `solanatracker/data-api-sdk` | SDK Data API + Datastream | Kalau pakai Solana Tracker. |
| `warp-id/solana-trading-bot` (lama) | Sniper Raydium klasik | Arsitektur filter klasik. |

⚠️ Banyak repo "sniper bot" di GitHub berisi **malware/drainer** (minta private key, dependency mencurigakan). Jangan pernah jalankan repo asing dengan private key asli. Baca kodenya, ambil idenya, tulis ulang.

## 7. Platform komersial (referensi fitur)

GMGN, Axiom, Photon, BullX, Trojan, BonkBot: fitur yang patut ditiru → migration sniper, auto-sell bertingkat, trailing, copy trade dengan filter mcap/slippage/blacklist, wallet leaderboard (PnL, win rate, ROI). Kebanyakan review di internet = affiliate, **tanpa data backtest**.

## 8. Strategi exit dari komunitas (rule of thumb, belum terbukti)

- Tiered: jual 1/3 di 2x, 1/3 di 5x, 1/3 trailing.
- Moonbag: jual 50% di 2x (modal balik), 25% moonbag, 25% trailing.
- Pindah SL ke break-even setelah +100%.
- Time stop kalau target/SL nggak kena dalam window tertentu.
- Milestone mcap untuk token pump.fun (50k/100k/500k).
→ Semua ini kita jadikan **opsi config** lalu diuji pakai replay data sendiri (bukan dipercaya mentah).

## 9. Pelajaran LLM-as-trader

- **Alpha Arena (nof1) Season 1, Okt–Nov 2025**: 6 LLM dikasih $10k trading crypto perp otonom. **Lebih dari separuh rugi** (Qwen3 Max +22%, DeepSeek +5%, Claude Sonnet 4.5 −42%, Gemini 2.5 Pro −46%, Grok −58%, GPT-5 −59%). Pelajaran: LLM sebagai pengambil keputusan trading langsung = high variance, nggak stabil.
- Jupiter (Jul 2026) rilis **hosted Trading MCP server untuk AI agent**; GMGN punya skills. Ekosistem "AI agent trading" makin banyak, tapi yang profit konsisten tetap **sistem deterministik + data**. LLM paling berguna untuk riset, klasifikasi, dan review.

## 10. Tech stack refs

- **Bun 1.3+** (terpasang di VPS: **1.4.3**): `Bun.serve` fullstack (HTML import + HMR), `Bun.sql` (Postgres/MySQL/SQLite bawaan), `Bun.redis` bawaan, WebSocket pub/sub bawaan, `bun test`, single-file executable.
- **TimescaleDB** di Postgres: hypertable + compression + **continuous aggregates** (pas banget buat candle multi-timeframe 15s/1m/5m/15m/1h/4h dari data tick).
- **TradingView lightweight-charts** (open source) untuk candle + marker entry/exit.
- **grammY** (Telegram bot, jalan di Bun), **@mtcute/bun** (userbot MTProto).

## Sumber

- Post asli (dipaste user) + [GMGNAI/skillmarket-demos](https://github.com/GMGNAI/skillmarket-demos), [aitrader README](https://raw.githubusercontent.com/GMGNAI/skillmarket-demos/main/aitrader/README.md), [GMGNAI/gmgn-skills](https://github.com/GMGNAI/gmgn-skills)
- Jupiter: [Swap V2 order & execute](https://developers.jup.ag/docs/swap/order-and-execute), [Ultra deprecated notice](https://developers.jup.ag/docs/ultra/execute-order), [Changelog Mar 2026](https://developers.jup.ag/changelog/2026-03), [Changelog](https://developers.jup.ag/changelog), [Portal migration](https://developers.jup.ag/docs/portal/migration), [Portal FAQ](https://developers.jup.ag/docs/portal/faq), [Token info guide](https://developers.jup.ag/docs/guides/how-to-get-token-information), [Organic score](https://developers.jup.ag/blog/what-is-organic-score), [Trade safely](https://hub.jup.ag/guides/swap/tutorials/trade-safely)
- Solana Tracker: [Pricing](https://docs.solanatracker.io/pricing.md), [Data API](https://solanatracker.io/data-api), [SDK](https://github.com/solanatracker/data-api-sdk), [Yellowstone gRPC](https://www.solanatracker.io/yellowstone-grpc)
- Helius: [Plans](https://www.helius.dev/docs/billing/plans.md), [Pricing](https://www.helius.dev/de/pricing), [Sender SWQoS-only](https://www.helius.dev/docs/de/sending-transactions/sender-swqos-only), [Trading overview](https://www.helius.dev/docs/zh/trading/overview), [Incident SG](https://pingoru.io/providers/helius/incidents/6534577)
- PumpPortal: [Real-time data API](https://pumpportal.fun/data-api/real-time)
- Pump.fun/PumpSwap: [The Block — PumpSwap](https://www.theblock.co/post/347360/pump-fun-launches-dex-called-pumpswap-to-instantly-migrate-graduated-tokens), [The Block — creator revenue](https://www.theblock.co/post/354038/pumpswap-revenue-tokens), [MadeOnSol — PumpSwap](https://madeonsol.com/blog/what-is-pumpswap), [MadeOnSol — fees](https://madeonsol.com/blog/pumpfun-revenue-sharing-pumpswap-fees-creators), [BlockEden — PumpSwap volume](https://blockeden.xyz/blog/2026/04/12/pumpswap-16b-volume-pumpfun-amm-raydium-solana-dex/), [99Bitcoins — graduation rate](https://99bitcoins.com/news/presales/pump-crypto-graduation-rate-price-analysis/)
- Launchpad: [Phemex — Pump.fun vs Bonk.fun](https://phemex.com/blogs/pump-fun-vs-bonk-fun-memecoin-launchpads), [Cointelegraph via TradingView](https://www.tradingview.com/news/cointelegraph:9c3a24b10094b:0-how-pump-fun-captured-80-of-solana-memecoins-and-can-it-last/), [OKX — LetsBONK flips](https://www.okx.com/en-eu/orbit/news/letsbonk-flips-pumpfun-as-solana-s-top-memecoin-launchpad-49066129410084), [Repyl Substack](https://repyl.substack.com/p/memecoin-trading-strategy-market)
- Riset: [arXiv 2607.02795 — Sniper Cohorts](https://arxiv.org/pdf/2607.02795), [arXiv 2507.01963](https://arxiv.org/pdf/2507.01963v2), [The Defiant — 99% pump & dump](https://thedefiant.io/news/defi/alarming-99-of-memecoin-launches-on-pumpfun-are-pump-and-dumps-or-rug-pulls-report), [Serial deployers](https://killy7.substack.com/p/serial-token-deployers-on-solana), [BlockEden — launchpad 2](https://blockeden.xyz/blog/2026/04/20/meme-launchpad-2-pump-fun-letsbonk-anti-sniper-reputation/)
- Token-2022: [Raydium oracle & token risks](https://docs.raydium.io/security/oracle-and-token-risks.md), [Neodyme Token-2022 report](https://www.neodyme.io/reports/Token%202022%20-%202024.pdf), [dev.to — extension bytes](https://dev.to/verixia_233e4721792ce3390/programmatic-spl-token-risk-analysis-inspecting-mint-freeze-and-token-2022-extension-bytes-l0d), [Cointelegraph — burn scam](https://cointelegraph.com/news/new-solana-scam-burn-tokens-from-inside-sol-wallets)
- DexScreener: [Docs API](https://docs.dexscreener.com/api/reference), [MCP server (limits)](https://github.com/opensvm/dexscreener-mcp-server)
- Meteora: [DAMM v2 API](https://docs.meteora.ag/developer-guide/integrations/damm-v2/apis/1-api-endpoints), [DAMM v2 API reference](https://docs.meteora.ag/developer-guides/damm-v2/api-reference/overview.md)
- RugCheck: [Apidog guide](https://apidog.com/ar/blog/rugcheck-api/), [GOAT MCP client](https://glama.ai/mcp/servers/@cryptoleek-team/goat-mcp/blob/d2e796192eac82c5c78f93be345183d7007d034f/rugcheck/src/api.ts)
- Birdeye/GeckoTerminal: [Birdeye packages](https://docs.birdeye.so/docs/data-accessibility-by-packages), [Birdeye WS](https://docs.birdeye.so/docs/websocket), [Birdeye changelog Agu 2026](https://docs.birdeye.so/changelog/20260830-add-market-cap-chart-mode-to-websocket-ohlcv-subscriptions), [GeckoTerminal FAQ](https://apiguide.geckoterminal.com/faq), [CoinGecko support](https://support.coingecko.com/hc/en-us/articles/22612838274841-Does-GeckoTerminal-have-an-API)
- gRPC: [Chainstack Yellowstone](https://chainstack.com/yellowstone-grpc-more-streams-same-price/), [Alchemy gRPC pricing](https://support.alchemy.com/articles/5952597732-how-is-solana-grpc-yellowstone-streaming-priced), [RPC Fast pricing](https://rpcfast.com/blog/solana-rpc-pricing)
- Bot OSS: [GitHub topic sniper](https://github.com/topics/solana-memecoin-sniper-bot), [muxprotocol bot](https://gittrend.io/repo/muxprotocol/solana-trading-bot), [bitman09](https://awesome.ecosyste.ms/projects/github.com%2Fbitman09%2Fpumpfun-sniper-bot), [roswelly](https://awesome.ecosyste.ms/projects/github.com%2Froswelly%2Fpumpfun-buy-sell)
- Platform: [GMGN blog — platform 2026](https://gmgn.ai/blog/best-meme-coin-trading-platforms-2026/), [Medium — TG bots 2026](https://medium.com/coinmonks/ive-analysed-the-best-telegram-trading-bots-for-memecoins-in-2026-88e4c63d0266)
- Exit: [DEXTools — take profits](https://www.dextools.io/tutorials/memecoin-trading-strategy-take-profits), [MadeOnSol exit guide](https://madeonsol.com/blog/solana-memecoin-exit-strategy-guide), [Definitive](https://www.definitive.fi/blog/how-to-trade-memecoins-onchain)
- LLM trading: [Forklog — Alpha Arena](https://forklog.com/en/four-out-of-six-ai-models-suffer-losses-in-trading-tournament/), [Buildix — lessons](https://www.buildix.trade/blog/nof1-alpha-arena-lessons-ai-trading-byok-strategy-advisor-2026)
- Bun: [Bun v1.3](https://bun.com/blog/bun-v1.3); Telegram: [mtcute](https://github.com/kravetsone/mtcute), [mtcute ref](https://ref.mtcute.dev/)
