# 04 — Strategi Multi-Profile & Multi-Timeframe

> Semua angka di bawah = **titik awal hipotesis**, bukan setting final. Angka final ditentukan dari data Fase 1–4 (Trigger Lab, shadow tracking, replay).

## 1. Konsep: "profile"

Satu profile = satu gaya trading lengkap: sumber trigger, filter, security, aturan multi-timeframe (MTF), sizing, exit, bucket modal. Profile jalan paralel, masing-masing bisa **off / paper / live** sendiri-sendiri.

| Profile | Gaya | Timeframe | Sumber trigger | Hold | Risiko | Fase mulai |
|---|---|---|---|---|---|---|
| `migration_momentum` | Momentum pasca-migrasi | trend 5m · setup 1m · trigger 15s | PumpPortal `subscribeMigration` | 2–60 menit | Tinggi | **3 (pertama)** |
| `trending_momentum` | Momentum token yang lagi rame | trend 1h · setup 15m · trigger 1m | DexScreener boosts/profiles, GMGN trending/hot, Jupiter organic | 15 menit – 6 jam | Sedang-tinggi | **3 (pertama)** |
| `smart_money` | Konfluensi wallet pintar | trend 15m · trigger real-time | Wallet watchlist (PumpPortal/RPC), GMGN `market signal` | 5 menit – 4 jam | Sedang-tinggi | 6 |
| `swing_dip` | Beli koreksi token mapan | trend 4h · setup 1h · trigger 15m | GMGN/DexScreener (umur > 24 jam–7 hari) | jam – hari | Sedang | 6 |
| `near_graduation` | Degen bonding curve 70–95% | trigger 15s / tick | PumpPortal new token + trade stream | 1–15 menit | Sangat tinggi | 6 |
| `curve_sniper` | Degen detik pertama | tick | PumpPortal new token | detik – 5 menit | Ekstrem | 6+ (opsional) |
| `kol_call` | Call channel Telegram | tick / 15s | Userbot Telegram | menit | Sangat tinggi | 6 |

**Kenapa mulai dari 2 profile momentum?** Latency ±1 detik masih oke, data paling gampang didapat (gratis), dan frekuensinya cukup untuk ngumpulin ratusan trade paper dalam beberapa minggu.

## 2. Multi-timeframe framework

Tiap profile mendefinisikan 3 lapis:

| Lapis | Fungsi | Contoh kondisi |
|---|---|---|
| **Trend (HTF)** | Arah besar — jangan lawan arus | harga > VWAP anchored sejak launch/migrasi; EMA21 naik; drawdown dari ATH < 35% |
| **Setup (MTF)** | Kondisi siap — pullback/konsolidasi sehat | pullback 10–30% ke EMA/VWAP dengan volume mengecil; higher low terbentuk |
| **Trigger (LTF)** | Momen masuk | candle reclaim/breakout high setup dengan volume z-score > 2 dan buy/sell ratio > 1.3 |

**Masalah token baru:** token umur 10 menit belum punya candle 1h. Solusi:
- HTF diganti **"since-launch features"**: VWAP anchored dari launch/migrasi, ATH sejak launch, % dari ATH, umur, jumlah holder vs waktu.
- Candle dibangun sendiri dari trade stream (1s → 15s → 1m → 5m → 15m → 1h → 4h) lewat Timescale continuous aggregate + agregasi in-memory untuk TF kecil.
- Untuk swing, backfill OHLCV dari GeckoTerminal (gratis 30 call/menit).

### Indikator & fitur yang dihitung
| Kategori | Fitur |
|---|---|
| Harga | VWAP anchored (launch/migrasi), EMA 9/21/50, RSI 14, ATR 14, jarak dari ATH, return 15s/1m/5m/15m/1h |
| Volume & flow | volume SOL per TF, volume z-score (vs rolling 30 bar), buy vol / sell vol, net flow SOL, jumlah trade, rata-rata ukuran trade |
| Partisipasi | unique buyers per menit, holder baru per menit, rasio buyer baru vs lama |
| Distribusi | top10 %, dev %, bundler %, sniper %, insider %, fresh wallet %, wallet ring sniper (cohort) |
| Kualitas | organic score (Jupiter), sosial ada (X/TG/web), DexScreener paid profile/boost, smart money count, KOL count |
| Dev | jumlah token yang pernah dibuat, rug ratio / survival rate token sebelumnya, sumber dana wallet dev (CEX vs wallet baru vs cluster rugger) |
| Likuiditas | likuiditas SOL/USD, perubahan likuiditas 1m/5m, price impact untuk ukuran order kita |
| LLM (opsional) | narrative tag, copycat flag, meme quality score (lihat `08-llm.md`) |

## 3. Filter (config-driven)

Format rule: `field`, operator, nilai, dan **kebijakan null**.

```yaml
# config/strategy.example.yaml (potongan)
version: 1
defaults:
  on_null: reject          # "missing data is never good news"
  critical_fields: [liquidity_usd, top10_pct, dev_pct, mint_authority, freeze_authority]
  cross_check:             # field kritis dibandingkan 2 provider
    top10_pct: { providers: [gmgn, solanatracker], max_abs_diff: 8 }

profiles:
  migration_momentum:
    mode: paper            # off | paper | live
    bucket_pct: 40         # porsi modal
    triggers: [pumpportal.migration]
    wait_after_trigger_sec: 30        # hindari dump pertama setelah migrasi
    eval_window_sec: 900              # token dievaluasi ulang tiap candle sampai 15 menit
    filters:
      - { field: liquidity_usd,   op: gte, value: 15000 }
      - { field: mcap_usd,        op: between, value: [40000, 600000] }
      - { field: holders,         op: gte, value: 150 }
      - { field: top10_pct,       op: lte, value: 30 }
      - { field: dev_pct,         op: lte, value: 5 }
      - { field: bundler_pct,     op: lte, value: 20 }
      - { field: sniper_pct,      op: lte, value: 15 }
      - { field: dev_rug_ratio,   op: lte, value: 0.5, on_null: ignore }
      - { field: unique_buyers_1m, op: gte, value: 15 }
      - { field: buy_sell_ratio_1m, op: gte, value: 1.2 }
      - { field: price_change_5m, op: between, value: [-20, 150] }
    mtf:
      trend:   { tf: 5m,  all: [ "close > vwap_since_migration", "drawdown_from_ath_pct < 40" ] }
      setup:   { tf: 1m,  any: [ "pullback_pct between 8 and 30", "range_bars >= 3" ] }
      trigger: { tf: 15s, all: [ "close > setup_high", "vol_z > 2", "buy_sell_ratio > 1.3" ] }
    entry:
      size_sol: 0.1
      max_price_impact_pct: 2.0
    exits: { ref: exits.momentum_fast }

  trending_momentum:
    mode: paper
    bucket_pct: 40
    triggers: [dexscreener.boost, dexscreener.profile, gmgn.trending, gmgn.hot]
    filters:
      - { field: age_min,         op: gte, value: 30 }
      - { field: liquidity_usd,   op: gte, value: 30000 }
      - { field: mcap_usd,        op: between, value: [100000, 5000000] }
      - { field: organic_score,   op: gte, value: 40 }
      - { field: top10_pct,       op: lte, value: 25 }
      - { field: holders,         op: gte, value: 500 }
      - { field: vol_1h_usd,      op: gte, value: 50000 }
    mtf:
      trend:   { tf: 1h,  all: [ "close > ema21", "close > vwap_since_launch" ] }
      setup:   { tf: 15m, all: [ "pullback_to_ema21_pct <= 5", "vol_declining_bars >= 2" ] }
      trigger: { tf: 1m,  all: [ "close > prev_high", "vol_z > 1.5" ] }
    entry:
      size_sol: 0.15
      max_price_impact_pct: 1.5
    exits: { ref: exits.momentum_swingy }
```

### Shadow tracking (inovasi utama vs post)
Setiap token yang **ditolak** tetap dipantau 60 menit seolah-olah dibeli ("entry hipotetis" di harga saat ditolak). Hasilnya:
- **Rule efficiency** = berapa % token yang ditolak rule X ternyata rug/dump (bagus) vs pump (kehilangan peluang).
- Rule yang lebih sering buang winner daripada nyelametin dari loser → kandidat dilonggarkan.
- Dashboard "Trigger Lab → Filter effectiveness" menampilkan ini per rule.

## 4. Security check (wajib, gagal satu = skip)

| Cek | Cara | Fail kalau |
|---|---|---|
| Mint authority | `getAccountInfo(mint)` parse | ≠ null |
| Freeze authority | sama | ≠ null |
| Token program | owner = Token / Token-2022 | program lain |
| Token-2022 extensions | parse TLV extension | ada `permanentDelegate`, `transferFeeConfig` (fee > 0), `transferHook` (program tak dikenal), `nonTransferable`, `defaultAccountState=frozen`, `pausable` |
| Metadata mutable | metaplex metadata `isMutable` | warn (bukan fail) — bisa jadi fitur skor |
| LP | pool pump.fun/PumpSwap: aman by design; Raydium/Meteora: cek LP burn/lock % | LP unlocked besar |
| Simulasi jual | bangun tx sell (jumlah token hasil quote beli) → `simulateTransaction` | error / out ≈ 0 |
| Round-trip quote | quote buy X SOL → quote sell token hasilnya | rugi > (fee wajar + 3%) |
| Cross-check | GMGN `is_honeypot`, rug ratio; RugCheck risk; Jupiter `audit.isSus` | ada flag berat |
| Blacklist | dev, funder dev, cluster wallet ring | match |

Security di-cache per mint (TTL pendek untuk token baru), dan **dicek ulang berkala selama posisi terbuka** ("escape monitor" ala GMGN).

## 5. Exit engine

Semua exit dievaluasi **setiap tick harga** (dari stream), pakai **nilai jual executable** (quote lokal dari reserve, termasuk price impact & fee), bukan harga mid.

```yaml
exits:
  momentum_fast:
    hard_sl_pct: -15
    momentum_fail: { within_sec: 90, min_gain_pct: 5 }      # belum naik 5% dalam 90 dtk → keluar
    break_even: { activate_at_pct: 20, lock_pct: 2 }          # setelah +20%, SL pindah ke +2%
    take_profit_ladder:
      - { at_pct: 25,  sell_pct: 40 }
      - { at_pct: 60,  sell_pct: 30 }
      - { at_pct: 1000, sell_pct: 100 }                       # sisa = moonbag, biasanya kena trailing duluan
    trailing:                                                 # jarak melebar seiring profit
      tiers:
        - { activate_at_pct: 10,  distance_pct: 6 }
        - { activate_at_pct: 40,  distance_pct: 12 }
        - { activate_at_pct: 100, distance_pct: 20 }
      # alternatif: { mode: atr, tf: 15s, k: 3 }
    max_hold_sec: 1800
    stale: { no_new_high_sec: 300, max_pnl_pct: 5 }
    events:
      dev_sell_pct_gte: 20          # dev jual ≥ 20% holding-nya → keluar
      top_holder_sell_pct_gte: 50   # salah satu top5 buang ≥ 50%
      liquidity_drop_pct_1m: 25
      sell_pressure: { window_sec: 30, sell_buy_ratio_gte: 3 }
      security_flag_change: true
    panic:                          # dipakai untuk SL/event/kill
      slippage_bps: 2500
      priority_multiplier: 3
      retries: 4

  momentum_swingy:
    hard_sl_pct: -18
    structure_sl: { below: setup_low, buffer_pct: 2 }         # SL di bawah low setup, mana yang lebih dekat
    break_even: { activate_at_pct: 30, lock_pct: 5 }
    take_profit_ladder:
      - { at_pct: 30,  sell_pct: 33 }
      - { at_pct: 80,  sell_pct: 33 }
    trailing: { tiers: [ { activate_at_pct: 20, distance_pct: 12 }, { activate_at_pct: 100, distance_pct: 25 } ] }
    max_hold_sec: 21600
    events: { dev_sell_pct_gte: 20, liquidity_drop_pct_1m: 30, security_flag_change: true }
```

Prioritas evaluasi tiap tick: **kill/panic → event exit → hard/structure SL → break-even stop → trailing → TP ladder → momentum-fail → stale → max hold.**

## 6. Ide strategi tambahan (dari riset)

1. **Konfluensi smart money**: ≥ 2–3 wallet skor tinggi beli token yang sama dalam 5 menit, dan harga belum naik > X% dari entry mereka (copyability). Exit ikut kalau mayoritas mereka jual.
2. **Wallet scoring** (ala GMGN wallet eval): track record (disiplin SL, breadth profit, ROI, win rate, sampel), copyability (entry mcap, profit/trade, holding time vs latency kita), label gaya (sniper/bot/dev/diamond hand). Wallet "deployer" didiskon.
3. **Dev paid DexScreener profile/boost** sebagai sinyal komitmen dev (fitur skor, bukan trigger tunggal).
4. **Second wave**: token yang pump lalu retrace 50–70%, volume kering, lalu volume balik → entry di reclaim VWAP (profil `swing_dip` versi intraday).
5. **Near-graduation**: bonding curve 70–95% dengan kecepatan isi tinggi & holder sehat → harapan pump saat migrasi; keluar sebelum/tepat setelah migrasi.
6. **Time-of-day filter**: aktifkan profile hanya di jam UTC yang terbukti positif (heatmap Trigger Lab).
7. **Caller scoring** (Telegram/X): skor tiap caller dari data historis (return setelah call dengan delay kita). Caller yang tokennya langsung dump setelah call = kita abaikan.
8. **Anti wallet-ring**: kalau first buyers didominasi cluster sniper persisten (arXiv 2607.02795), skip atau kecilkan size.
9. **Narrative rotation**: LLM tag narrative → statistik narrative mana yang lagi menang minggu ini → bobot skor.

## 7. Scoring (setelah lolos hard filter)

```
score = Σ w_i · normalize(feature_i)   → 0..100
entry kalau score ≥ threshold_profile
size  = base_size × f(score)   (mis. 0.75× / 1× / 1.25×, dibatasi risk manager)
```
Bobot awal sama rata, lalu di-fit dari data (Fase 4) — korelasi fitur vs hasil (max_ret, rugged) di `tracked_paths`. Jaga supaya sederhana (≤ 10 fitur) untuk menghindari overfitting.
