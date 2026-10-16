# 01 — Review Post "Bot Trading Meme Solana pakai AI Agent" + Repo GMGN

> Status: analisa awal (2026-10-17). Semua angka fee/limit di sini **wajib diverifikasi ulang** sebelum live.

## TL;DR

- **Workflow-nya bener secara garis besar** (trigger → filter → security → entry → exit → dry run). Itu memang kerangka standar bot memecoin yang sehat.
- **LLM-nya hampir pasti bukan yang "trading".** Di post itu "AI agent" = *coding agent* (Claude Code / Codex / OpenClaw dsb) yang dipakai buat **nulis kode dan diskusi parameter**. Bot yang jalan sendiri = aturan deterministik (angka di config).
- Demo GMGN `aitrader` juga sama: LLM cuma **menjelaskan** token yang sudah lolos filter, bahkan di kode sekarang `LLMJudge.judge` masih *placeholder heuristic*, belum LLM beneran. TP/SL di demo itu **cuma teks**, belum dieksekusi. Beli tetap manual (user pencet tombol).
- Klaim "1 jt → 8 jt" itu **anekdot**, tanpa data win rate, jumlah trade, drawdown, atau periode. Jangan dijadikan patokan.
- Celah terbesar post: **dry run yang terlalu optimis**, **monitoring harga via polling 2–5 detik**, dan **biaya per trade yang nggak dihitung** (fee Jupiter 0.5% buat token < 24 jam, fee pool, priority fee, tip, rent ATA, slippage). Untuk target 10–20% per trade, biaya ini bisa makan 30–60% profit kotor.

---

## 1. Bedah per bagian

### 1.1 Trigger
| Poin di post | Penilaian | Catatan / Upgrade |
|---|---|---|
| Nggak scan semua token, tunggu dari sumber tertentu | ✅ Benar | Event-driven = hemat API & lebih cepat. |
| DexScreener, GMGN trending, Meteora hot pool, migrasi Pump.fun, smart wallet, Telegram, X | ✅ Lengkap | Tambah: **PumpPortal WS** (new token + migration gratis), **Jupiter Tokens API** (organic score), **GMGN `market trenches`/`market signal`**, **launchpad lain** (LetsBonk, Bags, Meteora DBC). |
| "Pantau dulu sebelum build" | ✅✅ Ini poin paling penting di post | Kita jadikan **Fase 1 khusus observasi**: rekam jalur harga tiap token 60–120 menit setelah trigger → statistik per sumber (berapa % yang nyentuh +20/+50/+100%, kapan peak, kapan dump, rug rate). |

### 1.2 Filter
| Poin | Penilaian | Upgrade |
|---|---|---|
| Semua angka di config, bukan hardcode | ✅ | + **schema validation** (zod), **versioning** config, **hot reload**, dan tiap keputusan nyimpen `config_version`. |
| Gate kalau data null/0 → skip | ✅ Penting | Kita bikin `on_null: reject|ignore` per field + **cross-check 2 provider** untuk field kritis (top10, dev%, bundler%). |
| Market cap, liq, volume, umur, dev hold, bundler, sniper, top10, Δharga 1m/5m | ✅ | + organic score (Jupiter), unique buyers/menit, buy/sell ratio, holder growth, **reputasi dev** (riwayat token sebelumnya, rug ratio), sumber dana dev wallet, fresh wallet %, smart money/KOL count. |
| "Ini bagian paling lama, bisa berbulan-bulan" | ✅ Jujur | Kita percepat pakai **shadow tracking**: token yang DITOLAK filter tetap dipantau harganya → ketahuan rule mana yang buang winner vs rule mana yang nyelametin dari rug. Tuning jadi berbasis data, bukan feeling. |

### 1.3 Security check
| Poin | Penilaian | Upgrade |
|---|---|---|
| Honeypot, mint authority, freeze authority, risiko token program | ✅ | Detailkan Token-2022 extensions: **permanentDelegate** (bisa tarik/burn token dari wallet lo), **transferFeeConfig** (fee max = honeypot), **transferHook**, **defaultAccountState=frozen**, **nonTransferable**, pausable. |
| Gagal satu → skip | ✅ | + simulasi jual beneran (`simulateTransaction` sell tx) dan **round-trip quote check** (buy X → sell semua → kalau rugi > fee wajar + threshold = pajak tersembunyi / honeypot). Cross-check RugCheck + GMGN `is_honeypot`/rug ratio + Jupiter `audit.isSus`. |

### 1.4 Entry
| Poin | Penilaian | Upgrade |
|---|---|---|
| Lewat API Jupiter | ✅ tapi **API-nya berubah** | Jupiter **Ultra API sudah deprecated** → sekarang **Swap API V2** (`/order` + `/execute`, atau `/build` buat transaksi custom). Free tier cuma **1 RPS** (keyless 0.5 RPS). Platform fee **10 bps** biasa, **50 bps untuk token umur < 24 jam** (= hampir semua memecoin). |
| Max posisi, nominal, slippage, daily loss/profit limit, priority fee | ✅ | + circuit breaker (N loss beruntun → pause), batas exposure per profile, cooldown re-entry per token, **jam trading** (whitelist jam UTC yang terbukti profit — ini formalisasi dari observasi dia "profit sering balik ke market di jam tertentu"). |

### 1.5 Exit
| Poin | Penilaian | Upgrade |
|---|---|---|
| Monitor tiap 2–5 detik via Jupiter | ⚠️ **Lemah** | Memecoin bisa -40% dalam 1–2 detik. Polling Jupiter juga kena limit 1 RPS. Solusi: **harga real-time dari stream** (PumpPortal trades, `accountSubscribe` ke vault pool via RPC WebSocket, atau gRPC) + hitung **nilai jual executable lokal** dari reserve pool (rumus constant product), Jupiter cuma dipanggil saat eksekusi. |
| Hard SL, TP 1000%, trailing aktif +10% jarak 5%, max hold | ✅ konsep | Trailing 5% fix terlalu sempit buat volatilitas meme → sering ke-shake out. Upgrade: **trailing bertingkat** (makin profit makin lebar) atau **ATR-based**, **TP ladder + moonbag**, **break-even stop**, **momentum-failure exit** (kalau dalam T detik nggak naik ≥ Y%, keluar), **event exit** (dev jual, top holder dump, liquidity turun drastis). |
| — | ❌ Tidak dibahas | SL di memecoin hampir selalu **slip lebih dalam** dari setting (SL -15% realisasi bisa -25%). Exit darurat butuh priority fee/slippage lebih tinggi + retry bertingkat + jalur fallback langsung ke pool (bukan cuma Jupiter). |

### 1.6 Dry run
| Poin | Penilaian | Upgrade |
|---|---|---|
| Dry run selama mungkin, ratusan posisi | ✅✅ | Tapi dry run naif (fill di harga mid saat sinyal) **jauh lebih bagus dari realita**. Kita bikin **paper trading realistis**: delay latency, quote beneran untuk jumlah persis, potong semua fee, simulasi gagal transaksi, exit pakai quote jual (price impact). |
| Catat win rate, profit, rugi terbesar, slippage, fee, hasil per trigger | ✅ | + MFE/MAE per trade (buat tuning TP/SL), profit factor, expectancy, max drawdown, hasil per jam, per profile, per exit reason, + **kalibrasi paper vs live** saat micro-live. |

---

## 2. Matematika yang nggak dibahas di post (penting!)

### 2.1 Biaya round-trip (estimasi kasar, posisi 0.2 SOL, token post-migrasi via Jupiter V2)
| Komponen | Per sisi | Round-trip |
|---|---|---|
| Network (base 0.000005 + priority ~0.0001–0.0005 + tip) | ~0.0003 SOL | ~0.3% |
| Platform fee Jupiter (token < 24 jam) | 0.50% | 1.0% |
| Fee pool (PumpSwap 0.25% + creator fee dinamis; Meteora DLMM bisa lebih tinggi) | 0.25–1.25% | 0.5–2.5% |
| Price impact + slippage + gerak harga selama latency | 0.5–2% | 1–4% |
| Rent ATA (0.00203928 SOL) — **refundable kalau akun ditutup** | 0 kalau di-close | 0 / ~1% kalau lupa close |
| **Total** | | **≈ 2.8% – 7.8%** |

### 2.2 Break-even win rate
Rumus: `p_BE = (L + c) / (W + L)` dengan W = rata-rata gain kotor, L = rata-rata loss kotor, c = biaya round-trip.

| TP rata-rata (W) | SL rata-rata (L) | Biaya (c) | Win rate minimal |
|---|---|---|---|
| 20% | 15% | 5% | **57%** |
| 15% | 10% | 5% | **60%** |
| 10% | 10% | 4% | **70%** |
| 30% | 15% | 4% | **42%** |
| 50% | 20% | 4% | **34%** |

Kesimpulan: **target 10–20% per trade cuma masuk akal kalau win rate tinggi banget atau biaya ditekan**. Makanya kita butuh: (a) eksekusi murah, (b) exit yang membiarkan winner lari (ladder + trailing lebar), (c) data MFE/MAE buat nentuin W & L yang realistis.

### 2.3 Latency & lokasi
VPS lo di **Tencent Cloud Singapore**. Bagus untuk Asia: Helius Sender punya endpoint **Singapore** (`sg-sender.helius-rpc.com`). Tapi buat profil "sniper" detik-pertama, lawannya bot yang co-located dengan validator + Jito → **jangan mulai dari sniping**. Mulai dari profil menit–jam (migration momentum, trending momentum) di mana latency ±1 detik masih aman.

---

## 3. Detail LLM di post & repo GMGN

### 3.1 Di post
- "Diskusikan topik2 ini sama agent kalian" → LLM dipakai sebagai **partner riset + coding agent**: bantu pilih trigger, nulis collector, nulis filter, isi config, analisa hasil dry run.
- Yang trading 50–80x/hari = **program deterministik**. Ini pendekatan yang benar: LLM terlalu lambat (detik), mahal per call, dan non-deterministik untuk keputusan entry/exit dalam hitungan detik.

### 3.2 `GMGNAI/gmgn-skills`
- Paket **15 skill** (format SKILL.md, di-install via `npx skills add GMGNAI/gmgn-skills`) yang bikin AI agent (Claude Code, Cursor, Codex, dsb) bisa manggil **`gmgn-cli`**:
  - Data: `token info/security/pool/holders`, `market trending`, `market trenches` (launch baru), `market signal` (smart money & large buy), `market hot-searches`, K-line.
  - Wallet: `portfolio holdings/activity/stats/created-tokens`, `track smartmoney/kol/follow-wallet`, `callout`.
  - Trading: `swap`, `multi-swap`, `order strategy` (TP/SL, trailing), `cooking` (buy + TP/SL sekaligus).
- Auth: `GMGN_API_KEY` (daftar di gmgn.ai/ai) + **Ed25519 signing key** (bukan wallet key) untuk swap/order; **IP whitelist, IPv4 only**.
- Rate limit (dari listing pihak ketiga, perlu verifikasi): leaky bucket ~10–20 req/s dengan bobot per endpoint; spam saat 429 bisa memperpanjang ban sampai 5 menit.
- ⚠️ Skill trading bisa dieksekusi agent **otomatis** kalau `GMGN_ALLOW_AUTOMATED_TRADES=1` + `--yes`. Untuk riset, **jangan pasang kunci swap** di mesin yang dipakai agent.

### 3.3 `GMGNAI/skillmarket-demos/aitrader`
Pipeline (dari README):
1. Ambil kandidat dari `market trending` (barisnya sudah bawa data due diligence).
2. **Hard gates deterministik**: honeypot, buy/sell tax, rug, bundler, dev holding, top10.
3. **Consensus**: hitung sinyal smart money + KOL.
4. **Momentum scoring**: momentum 5m & 1h, buy/sell ratio, turnover, consensus, safety, dev score.
5. **Dev reputation**: dari `portfolio created-tokens` + scan security token-token terakhir si dev; survival rate dominan; penalti relaunch nama baru, unsafe launch, dsb.
6. **LLM explanation** (hanya untuk survivor): verdict, conviction, crowdedness, thesis. Input disanitasi (nama token mentah nggak dikasih ke LLM — anti prompt injection). **Saat ini masih placeholder heuristic.**
7. Sizing dihitung kode, **user pencet beli**. Mode SHADOW (default, cuma log) vs LIVE.
- Stack: Python + FastAPI + 1 file `static/index.html`. Simpan posisi di JSON, decision log di JSONL.
- **TP/SL tidak dieksekusi** — cuma tampilan. Ada "escape monitor" yang cek ulang security tiap ronde dan kasih alert (severity ≥ 70) + tombol exit.
- Tab Wallet Evaluation: skor track record (dominan disiplin stop-loss), copy-tradeability (entry mcap, profit per trade, holding time vs latency kita), 14 label gaya trader, simulator backtest copy-trade (delay/slippage/gas). Threshold-nya masih heuristik, belum dikalibrasi ke PnL.

### 3.4 Yang kita ambil dari GMGN
- ✅ Pola **"rules cast wide → scoring cut hard → LLM explain/veto → risk engine final"**.
- ✅ **Dev reputation** dari riwayat token dev — fitur filter yang kuat.
- ✅ **Wallet scoring** untuk profil smart-money (dengan simulasi delay/slippage kita sendiri).
- ✅ **Sanitasi input LLM** & LLM nggak pernah nyentuh risk control.
- ✅ "Missing data is never good news" (dari demo memex) → filosofi null-gate kita.
- ❌ Yang nggak kita tiru: JSON file sebagai DB, polling sederhana, TP/SL manual, eksekusi cuma via satu jalur.

---

## 4. Apa yang kita kembangkan di atas post (ringkas)

1. **Fase observasi + Trigger Lab** (dashboard statistik per sumber) sebelum ada logika beli.
2. **Shadow tracking** token yang ditolak → tuning filter berbasis data.
3. **Multi-profile multi-timeframe** (degen detik–menit, momentum menit–jam, swing jam–hari) dengan bucket modal terpisah.
4. **Harga real-time dari stream + quote lokal dari reserve pool**, bukan polling Jupiter.
5. **Exit engine lengkap**: SL, ladder, break-even, trailing bertingkat/ATR, momentum-failure, event exit, panic mode.
6. **Paper trading realistis** + **replay/backtest** dari data rekaman + walk-forward.
7. **Risk manager** dengan circuit breaker & kill switch (dashboard + Telegram).
8. **LLM di jalur lambat**: narrative tagger, parser call Telegram, daily review yang ngusulin perubahan config (harus lolos replay + approve manual).
9. **Web monitoring** real-time (Bun) + alert Telegram.

Detail tiap poin ada di dokumen lain (lihat `README.md`).
