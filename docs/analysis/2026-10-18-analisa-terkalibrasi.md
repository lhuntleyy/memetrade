# Analisa fitur → hasil trade (2026-10-18T17:04 UTC, 48 jam terakhir)

## Ringkasan kesimpulan otomatis (token likuid ≥ $30k, biaya terukur)

- Semua sumber: **❌ tidak ada edge** — OOS mean -6.5% / median -4.3% dari 278 trade
- Migrasi: **❌ tidak ada edge** — OOS mean -10.4% / median -7.4% dari 114 trade
- DexScreener: **❌ tidak ada edge** — OOS mean -7.2% / median -7.8% dari 32 trade
- Smart money: **❌ tidak ada edge** — OOS mean -4.1% / median -2.1% dari 94 trade

Target = PnL replay exit `quick_flip` (TP +30%, trailing dari +20% jarak 4, SL −15%, momentum-fail 3 mnt, max hold 30 mnt) kalau masuk ±1 dtk setelah token dievaluasi, biaya round-trip TERUKUR (cost probe) per likuiditas token saat dievaluasi. Replay DIKALIBRASI ke paper trading (metode source: profit dibatasi di level TP, potongan per sumber {"wallet":0,"migration":7.3,"new_token":5.7,"dexscreener":1.9} poin/trade). Token yang gagal security dikeluarkan.

Model biaya (median round-trip, posisi 0,1 SOL, termasuk jaringan): keseluruhan 3.64%

| Likuiditas | probe | median |
|---|---|---|
| $0rb – $10rb | 743 | 3.71% |
| $10rb – $30rb | 167 | 3.15% |
| $30rb – $50rb | 66 | 2.68% |
| $50rb – $100rb | 44 | 2.64% |
| $100rb – ∞ | 48 | 1.21% |

Total baris: 9079 · dengan data harga setelah entry: 2304

## Token baru pump.fun (pumpportal.new_token)

**Baseline (semua):** 1051 trade · mean -10.4% · median -9.3% · win 4.4% · puncak≥25% 3.6% · kena SL 6.5%

### Korelasi peringkat (Spearman) fitur ↔ PnL

| Fitur | rho | n |
|---|---|---|
| vol_5m_usd | -0.17 | 1036 |
| txns_5m | -0.165 | 1036 |
| age_min | 0.151 | 1036 |
| buy_sell_ratio_5m | -0.15 | 1049 |
| entrapment_pct | 0.135 | 553 |
| rat_trader_pct | 0.126 | 553 |
| vol_1h_usd | -0.123 | 1036 |
| organic_score | 0.12 | 1050 |
| _evals | -0.09 | 823 |
| jup_buy_sell_ratio_5m | 0.087 | 327 |
| dev_created_count | -0.067 | 553 |
| net_buyers_5m | 0.064 | 406 |

### Bucket kuantil fitur paling berpengaruh

**vol_5m_usd** (rho -0.17)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 9.48 | 621 | -9.4% | -9.3% | 0% | 0% | 0.3% |
| 9.48 – 310.84 | 207 | -9.7% | -9.3% | 3.9% | 2.9% | 3.4% |
| 310.84 – 212.4rb | 208 | -15% | -9.4% | 15.9% | 13.5% | 28.4% |
| kosong | 15 | 0.2% | -6.4% | 33.3% | 26.7% | 0% |

**txns_5m** (rho -0.165)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 1 | 532 | -9.4% | -9.3% | 0% | 0% | 0.4% |
| 1 – 6 | 291 | -9.1% | -9.3% | 2.4% | 2.1% | 0.7% |
| 6 – 5.1rb | 213 | -15.6% | -9.4% | 16% | 13.1% | 30% |
| kosong | 15 | 0.2% | -6.4% | 33.3% | 26.7% | 0% |

**age_min** (rho 0.151)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0.49 – 2.24 | 207 | -12.8% | -9.3% | 7.2% | 7.2% | 16.9% |
| 2.24 – 9.89 | 207 | -9.7% | -9.3% | 4.3% | 2.9% | 3.9% |
| 9.89 – 10.91 | 207 | -11% | -9.3% | 1.4% | 1% | 5.3% |
| 10.91 – 12.27 | 207 | -9.8% | -9.3% | 3.9% | 2.9% | 3.4% |
| 12.27 – 1.1jt | 208 | -9.6% | -9.3% | 2.9% | 2.4% | 3.4% |
| kosong | 15 | 0.2% | -6.4% | 33.3% | 26.7% | 0% |

**buy_sell_ratio_5m** (rho -0.15)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 1 | 707 | -9.4% | -9.3% | 0.7% | 0.7% | 0.6% |
| 1 – 60.75 | 342 | -12.6% | -9.3% | 12% | 9.6% | 18.7% |
| kosong | 2 | -7.8% | -7.8% | 0% | 0% | 0% |

**entrapment_pct** (rho 0.135)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 99.35 | 553 | -10.4% | -9.3% | 4.2% | 3.4% | 5.6% |
| kosong | 498 | -10.5% | -9.3% | 4.6% | 3.8% | 7.4% |

**rat_trader_pct** (rho 0.126)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 85.61 | 553 | -10.4% | -9.3% | 4.2% | 3.4% | 5.6% |
| kosong | 498 | -10.5% | -9.3% | 4.6% | 3.8% | 7.4% |

### Rule terbaik in-sample (min 84 trade) — JANGAN dipercaya sebelum lihat walk-forward

| Rule | hasil |
|---|---|
| _sec_after_trigger ≥ 985 | 84 trade · mean -6.8% · median -9.3% · win 9.5% · puncak≥25% 8.3% · kena SL 2.4% |
| _evals ≤ 1 & _sec_after_trigger ≥ 718 | 98 trade · mean -6.9% · median -9.3% · win 11.2% · puncak≥25% 10.2% · kena SL 5.1% |
| age_min ≥ 15.26 | 106 trade · mean -8.3% · median -9.3% · win 4.7% · puncak≥25% 3.8% · kena SL 1.9% |
| age_min ≥ 15.26 & _sec_after_trigger ≥ 770 | 105 trade · mean -8.4% · median -9.3% · win 4.8% · puncak≥25% 3.8% · kena SL 1.9% |
| age_min ≥ 15.26 & _sec_after_trigger ≥ 718 | 105 trade · mean -8.4% · median -9.3% · win 4.8% · puncak≥25% 3.8% · kena SL 1.9% |

### Walk-forward pemilihan rule (4 fold, anchored)

| Fold | rule terpilih (dari data lampau) | latih mean | uji: rule | uji: tanpa filter |
|---|---|---|---|---|
| 1 | vol_1h_usd ≤ 10.29 & txns_5m ≤ 1 | -8.5% (65) | -9.3% (30) | -9.5% (210) |
| 2 | age_min ≥ 16.38 | -7.6% (43) | -6.9% (17) | -9.8% (210) |
| 3 | _sec_after_trigger ≥ 1.3rb | -5% (42) | 1% (3) | -10% (210) |
| 4 | jup_buy_sell_ratio_5m ≥ 1.58 | -6.5% (53) | -1.8% (6) | -10% (211) |

**Out-of-sample gabungan:** dengan rule → 56 trade · mean -7.2% · median -9.3% · win 8.9% · puncak≥25% 3.6% · kena SL 1.8%

**Out-of-sample tanpa filter:** 841 trade · mean -9.8% · median -9.3% · win 3.9% · puncak≥25% 3.1% · kena SL 4.2%

Rule paling sering terpilih: `vol_1h_usd ≤ 10.29 & txns_5m ≤ 1`

## Migrasi pump.fun (pumpportal.migration)

**Baseline (semua):** 293 trade · mean -12.9% · median -9.4% · win 26.3% · puncak≥25% 21.5% · kena SL 32.8%

### Korelasi peringkat (Spearman) fitur ↔ PnL

| Fitur | rho | n |
|---|---|---|
| gmgn_liquidity_usd | 0.371 | 103 |
| price_change_5m | 0.316 | 216 |
| dev_pct | 0.305 | 158 |
| smart_wallets | -0.303 | 103 |
| mcap_usd | 0.28 | 293 |
| price_change_1h | 0.231 | 221 |
| liquidity_usd | 0.229 | 293 |
| gmgn_holders | 0.217 | 103 |
| _evals | -0.198 | 250 |
| age_min | -0.191 | 222 |
| dev_team_hold_pct | 0.184 | 103 |
| sniper_pct | 0.171 | 103 |

### Bucket kuantil fitur paling berpengaruh

**gmgn_liquidity_usd** (rho 0.371)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 325.75 – 5.7rb | 20 | -25.1% | -16.3% | 0% | 0% | 45% |
| 5.7rb – 16rb | 20 | -29% | -26.8% | 25% | 15% | 70% |
| 16rb – 39.6rb | 21 | -16% | -18.8% | 23.8% | 23.8% | 42.9% |
| 39.6rb – 57rb | 20 | -24.9% | -6.3% | 30% | 20% | 45% |
| 57rb – 7.7jt | 22 | -4.9% | -6.8% | 22.7% | 13.6% | 4.5% |
| kosong | 190 | -9.3% | -8.5% | 29.5% | 25.3% | 28.4% |

**price_change_5m** (rho 0.316)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| -97.12 – -7.26 | 43 | -24% | -26.9% | 23.3% | 18.6% | 65.1% |
| -7.26 – 8.9 | 43 | -16.3% | -11.6% | 9.3% | 9.3% | 27.9% |
| 8.9 – 74.47 | 43 | -25.5% | -25.7% | 23.3% | 16.3% | 65.1% |
| 74.47 – 751 | 43 | -8.5% | -2.8% | 39.5% | 32.6% | 32.6% |
| 751 – 2jt | 44 | -5.2% | -5.9% | 38.6% | 36.4% | 13.6% |
| kosong | 77 | -4.7% | -8.4% | 24.7% | 18.2% | 10.4% |

**dev_pct** (rho 0.305)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 0.18 | 31 | -19.8% | -19.3% | 19.4% | 19.4% | 48.4% |
| 0.18 – 0.85 | 31 | -13.8% | -8.4% | 29% | 22.6% | 32.3% |
| 0.85 – 13.56 | 32 | -19.8% | -5.8% | 31.3% | 25% | 46.9% |
| 13.56 – 79.32 | 31 | -9.4% | -6.8% | 29% | 25.8% | 12.9% |
| 79.32 – 80.72 | 33 | 2.4% | -3.3% | 45.5% | 36.4% | 6.1% |
| kosong | 135 | -14.1% | -11.2% | 20.7% | 16.3% | 37% |

**smart_wallets** (rho -0.303)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 2 | 40 | -11.2% | -5.3% | 35% | 25% | 25% |
| 2 – 5 | 19 | -31.6% | -13.2% | 10.5% | 5.3% | 42.1% |
| 5 – 20 | 21 | -26.9% | -23.5% | 4.8% | 0% | 52.4% |
| 20 – 877 | 23 | -18% | -26.7% | 17.4% | 17.4% | 56.5% |
| kosong | 190 | -9.3% | -8.5% | 29.5% | 25.3% | 28.4% |

**mcap_usd** (rho 0.28)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 7.74 – 17.5rb | 58 | -17.2% | -11.6% | 13.8% | 8.6% | 34.5% |
| 17.5rb – 60.8rb | 58 | -19.4% | -23.5% | 31% | 24.1% | 53.4% |
| 60.8rb – 298.6rb | 59 | -11.1% | -19% | 30.5% | 28.8% | 47.5% |
| 298.6rb – 493.7rb | 58 | -13% | -3% | 43.1% | 36.2% | 27.6% |
| 493.7rb – 2120.2jt | 60 | -4.2% | -7.7% | 13.3% | 10% | 1.7% |

**price_change_1h** (rho 0.231)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| -95.44 – -58.41 | 44 | -17.7% | -11.9% | 13.6% | 9.1% | 36.4% |
| -58.41 – 29.99 | 44 | -24.5% | -25.3% | 25% | 18.2% | 56.8% |
| 29.99 – 404 | 44 | -11.2% | -23.3% | 31.8% | 31.8% | 54.5% |
| 404 – 821 | 44 | -9.5% | -2.7% | 43.2% | 34.1% | 29.5% |
| 821 – 2jt | 45 | -15.8% | -7.3% | 17.8% | 17.8% | 22.2% |
| kosong | 72 | -4.2% | -7.9% | 26.4% | 19.4% | 11.1% |

### Rule terbaik in-sample (min 23 trade) — JANGAN dipercaya sebelum lihat walk-forward

| Rule | hasil |
|---|---|
| dev_pct ≥ 79.32 | 33 trade · mean 2.4% · median -3.3% · win 45.5% · puncak≥25% 36.4% · kena SL 6.1% |
| dev_pct ≥ 79.32 & top_holders_pct ≥ 75.06 | 33 trade · mean 2.4% · median -3.3% · win 45.5% · puncak≥25% 36.4% · kena SL 6.1% |
| dev_pct ≥ 27.25 & top_holders_pct ≥ 75.06 | 45 trade · mean 0.8% · median -5.2% · win 37.8% · puncak≥25% 28.9% · kena SL 4.4% |
| top_holders_pct ≥ 92.96 | 31 trade · mean 0.7% · median -6.5% · win 29% · puncak≥25% 29% · kena SL 3.2% |
| top_holders_pct ≥ 75.06 & dev_pct ≥ 13.56 | 47 trade · mean 0.4% · median -5.2% · win 36.2% · puncak≥25% 29.8% · kena SL 4.3% |

### Walk-forward pemilihan rule (4 fold, anchored)

| Fold | rule terpilih (dari data lampau) | latih mean | uji: rule | uji: tanpa filter |
|---|---|---|---|---|
| 1 | top_holders_pct ≥ 80.75 & dev_pct ≥ 11.91 | -0.7% (15) | -7.8% (2) | -13.4% (58) |
| 2 | dev_pct ≥ 15.07 & top_holders_pct ≥ 77.52 | -1.5% (17) | 0.4% (13) | -11% (58) |
| 3 | smart_wallets ≤ 0 | 1.8% (17) | -17.4% (2) | -12.7% (58) |
| 4 | dev_pct ≥ 79.32 | 4.1% (27) | -3.5% (3) | -13.8% (61) |

**Out-of-sample gabungan:** dengan rule → 20 trade · mean -2.7% · median -6.5% · win 20% · puncak≥25% 20% · kena SL 10%

**Out-of-sample tanpa filter:** 235 trade · mean -12.7% · median -9.9% · win 25.5% · puncak≥25% 22.1% · kena SL 33.2%

Rule paling sering terpilih: `top_holders_pct ≥ 80.75 & dev_pct ≥ 11.91`

## DexScreener profile/boost

**Baseline (semua):** 317 trade · mean -8.4% · median -8.8% · win 29.7% · puncak≥25% 22.7% · kena SL 43.2%

### Korelasi peringkat (Spearman) fitur ↔ PnL

| Fitur | rho | n |
|---|---|---|
| age_min | 0.176 | 290 |
| dev_created_count | -0.172 | 126 |
| sniper_pct | -0.172 | 126 |
| txns_5m | -0.17 | 294 |
| organic_score | 0.163 | 317 |
| traders_5m | -0.141 | 309 |
| vol_5m_usd | -0.139 | 294 |
| top10_pct | 0.125 | 126 |
| liquidity_usd | 0.114 | 314 |
| dev_mints | -0.105 | 316 |
| mcap_usd | 0.104 | 317 |
| price_change_1h | -0.094 | 276 |

### Bucket kuantil fitur paling berpengaruh

**age_min** (rho 0.176)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0.52 – 5.99 | 57 | -12.5% | -21.2% | 33.3% | 33.3% | 64.9% |
| 5.99 – 9.73 | 58 | -9.4% | -18.1% | 31% | 27.6% | 55.2% |
| 9.73 – 16.9 | 58 | -11.3% | -12.8% | 32.8% | 24.1% | 48.3% |
| 16.9 – 49.7 | 58 | -7.2% | -11.9% | 31% | 22.4% | 44.8% |
| 49.7 – 1jt | 59 | -3.9% | -4.7% | 20.3% | 10.2% | 13.6% |
| kosong | 27 | -3.5% | -5% | 29.6% | 14.8% | 22.2% |

**dev_created_count** (rho -0.172)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 1 | 5 | -1.8% | -3.1% | 40% | 40% | 40% |
| 1 – 46 | 70 | -6.5% | -7.1% | 27.1% | 20% | 37.1% |
| 46 – 866 | 25 | -6.6% | -7.7% | 36% | 20% | 40% |
| 866 – 29.1rb | 26 | -14.6% | -26.3% | 30.8% | 38.5% | 61.5% |
| kosong | 191 | -8.6% | -8.9% | 29.3% | 21.5% | 43.5% |

**sniper_pct** (rho -0.172)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 0.21 | 50 | -4.1% | -7.1% | 34% | 28% | 30% |
| 0.21 – 2.83 | 25 | -8.4% | -4.5% | 28% | 12% | 32% |
| 2.83 – 11.37 | 25 | -9.7% | -18.7% | 28% | 28% | 56% |
| 11.37 – 46.85 | 26 | -13.7% | -23.2% | 26.9% | 26.9% | 65.4% |
| kosong | 191 | -8.6% | -8.9% | 29.3% | 21.5% | 43.5% |

**txns_5m** (rho -0.17)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 41 | 57 | -4.1% | -5% | 21.1% | 12.3% | 14% |
| 41 – 184 | 60 | -7.8% | -9.5% | 28.3% | 16.7% | 40% |
| 184 – 410 | 58 | -7.9% | -12.3% | 36.2% | 31% | 48.3% |
| 410 – 945 | 59 | -8% | -18.3% | 39% | 30.5% | 57.6% |
| 945 – 6.2rb | 60 | -15.9% | -19.3% | 23.3% | 25% | 63.3% |
| kosong | 23 | -2.7% | -4.9% | 30.4% | 17.4% | 21.7% |

**organic_score** (rho 0.163)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 76.26 | 317 | -8.4% | -8.8% | 29.7% | 22.7% | 43.2% |

**traders_5m** (rho -0.141)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 1 – 27 | 61 | -5.5% | -5% | 14.8% | 11.5% | 16.4% |
| 27 – 89 | 62 | -6.9% | -9.5% | 30.6% | 17.7% | 40.3% |
| 89 – 188 | 59 | -6.8% | -8.2% | 37.3% | 30.5% | 44.1% |
| 188 – 382 | 64 | -9.2% | -18.6% | 39.1% | 31.3% | 57.8% |
| 382 – 2.4rb | 63 | -14% | -18.7% | 25.4% | 23.8% | 60.3% |
| kosong | 8 | -1.9% | -4.8% | 37.5% | 12.5% | 12.5% |

### Rule terbaik in-sample (min 25 trade) — JANGAN dipercaya sebelum lihat walk-forward

| Rule | hasil |
|---|---|
| _sec_after_trigger ≥ 261 | 31 trade · mean -1.4% · median -2.3% · win 38.7% · puncak≥25% 22.6% · kena SL 16.1% |
| organic_score ≥ 43.61 | 33 trade · mean -1.6% · median -4.2% · win 30.3% · puncak≥25% 12.1% · kena SL 15.2% |
| txns_5m ≤ 8 | 30 trade · mean -1.9% · median -4.8% · win 20% · puncak≥25% 13.3% · kena SL 6.7% |
| top10_pct ≥ 23.05 | 51 trade · mean -2.7% · median -5.5% · win 33.3% · puncak≥25% 27.5% · kena SL 29.4% |
| smart_wallets ≥ 9 | 42 trade · mean -3.3% · median -6.3% · win 35.7% · puncak≥25% 38.1% · kena SL 38.1% |

### Walk-forward pemilihan rule (4 fold, anchored)

| Fold | rule terpilih (dari data lampau) | latih mean | uji: rule | uji: tanpa filter |
|---|---|---|---|---|
| 1 | _sec_after_trigger ≥ 358 & top_holders_pct ≥ 21.58 | 6.1% (15) | 6.4% (1) | -9.6% (63) |
| 2 | _sec_after_trigger ≥ 366 | 4.3% (21) | -8.2% (1) | -13.9% (63) |
| 3 | _sec_after_trigger ≥ 395 | 4.8% (18) | –% (0) | -6.5% (63) |
| 4 | price_change_1h ≥ 610 & liquidity_usd ≥ 9.6rb | 4.5% (16) | -8.7% (5) | -6.7% (65) |

**Out-of-sample gabungan:** dengan rule → 7 trade · mean -6.5% · median -8.2% · win 28.6% · puncak≥25% 14.3% · kena SL 42.9%

**Out-of-sample tanpa filter:** 254 trade · mean -9.2% · median -9.5% · win 29.1% · puncak≥25% 22% · kena SL 45.3%

Rule paling sering terpilih: `_sec_after_trigger ≥ 358 & top_holders_pct ≥ 21.58`

## Konfluensi smart money

**Baseline (semua):** 643 trade · mean -2.5% · median -3.7% · win 36.4% · puncak≥25% 27.1% · kena SL 35%

### Korelasi peringkat (Spearman) fitur ↔ PnL

| Fitur | rho | n |
|---|---|---|
| dev_created_count | -0.178 | 240 |
| jup_buy_sell_ratio_5m | 0.176 | 624 |
| top10_pct | 0.176 | 240 |
| txns_5m | -0.156 | 467 |
| top_holders_pct | 0.141 | 639 |
| price_change_1h | -0.109 | 417 |
| renowned_wallets | -0.102 | 240 |
| age_min | 0.1 | 464 |
| gmgn_liquidity_usd | 0.091 | 240 |
| vol_5m_usd | -0.089 | 467 |
| liquidity_usd | 0.085 | 640 |
| dev_mints | -0.078 | 639 |

### Bucket kuantil fitur paling berpengaruh

**dev_created_count** (rho -0.178)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 1 | 3 | 3.1% | -3.6% | 33.3% | 33.3% | 33.3% |
| 1 – 23 | 91 | 1.4% | -3.1% | 39.6% | 35.2% | 25.3% |
| 23 – 350 | 49 | 2.7% | -2.1% | 44.9% | 38.8% | 32.7% |
| 350 – 4rb | 48 | -10.5% | -17% | 27.1% | 18.8% | 54.2% |
| 4rb – 174.8rb | 49 | -3.5% | -4.9% | 40.8% | 22.4% | 44.9% |
| kosong | 403 | -3% | -3.8% | 35.2% | 25.3% | 34% |

**jup_buy_sell_ratio_5m** (rho 0.176)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0.1 – 0.98 | 124 | -5.6% | -6.3% | 21% | 13.7% | 29% |
| 0.98 – 1.19 | 125 | -7.8% | -7.1% | 24.8% | 16.8% | 44.8% |
| 1.19 – 1.41 | 124 | -2.8% | -5.4% | 44.4% | 35.5% | 44.4% |
| 1.41 – 1.73 | 125 | -2.2% | -3.5% | 40.8% | 30.4% | 39.2% |
| 1.73 – 10 | 126 | 5.8% | 1.2% | 53.2% | 42.1% | 22.2% |
| kosong | 19 | -2.5% | -3.6% | 21.1% | 5.3% | 5.3% |

**top10_pct** (rho 0.176)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 17.56 | 47 | -6.5% | -3.8% | 21.3% | 10.6% | 31.9% |
| 17.56 – 21.39 | 48 | -4.3% | -6.3% | 37.5% | 29.2% | 41.7% |
| 21.39 – 23.61 | 48 | -4% | -4.7% | 37.5% | 33.3% | 39.6% |
| 23.61 – 25.61 | 48 | 1.1% | -3.1% | 43.8% | 33.3% | 39.6% |
| 25.61 – 80.79 | 49 | 5% | 4% | 51% | 42.9% | 30.6% |
| kosong | 403 | -3% | -3.8% | 35.2% | 25.3% | 34% |

**txns_5m** (rho -0.156)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 33 | 92 | -0.6% | -3.6% | 33.7% | 18.5% | 17.4% |
| 33 – 99 | 94 | 1% | -3.6% | 40.4% | 30.9% | 29.8% |
| 99 – 240 | 93 | 0% | -3.6% | 41.9% | 39.8% | 40.9% |
| 240 – 446 | 93 | -4.5% | -13.1% | 39.8% | 31.2% | 49.5% |
| 446 – 9.4rb | 95 | -6.4% | -15.9% | 38.9% | 34.7% | 54.7% |
| kosong | 176 | -3.6% | -3.1% | 29.5% | 16.5% | 25.6% |

**top_holders_pct** (rho 0.141)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0 – 17.76 | 127 | -8.3% | -4.9% | 24.4% | 11% | 34.6% |
| 17.76 – 21.59 | 128 | -3.4% | -4.6% | 40.6% | 30.5% | 38.3% |
| 21.59 – 24 | 127 | -3.2% | -6.3% | 38.6% | 29.1% | 44.1% |
| 24 – 26.77 | 128 | -0.7% | -3.4% | 36.7% | 27.3% | 35.9% |
| 26.77 – 80.81 | 129 | 2.9% | -1.5% | 41.1% | 37.2% | 22.5% |
| kosong | 4 | 0.3% | 3.1% | 50% | 25% | 25% |

**price_change_1h** (rho -0.109)

| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| -95.06 – -7.22 | 83 | 1.1% | -3.6% | 37.3% | 22.9% | 19.3% |
| -7.22 – 31.44 | 82 | -0.3% | -2.7% | 32.9% | 24.4% | 25.6% |
| 31.44 – 119 | 84 | 0.6% | -5% | 44% | 35.7% | 38.1% |
| 119 – 232 | 83 | -1.7% | -6.5% | 47% | 43.4% | 48.2% |
| 232 – 108.2rb | 85 | -7.1% | -16.3% | 37.6% | 30.6% | 55.3% |
| kosong | 226 | -4.4% | -3.9% | 30.1% | 19% | 30.5% |

### Rule terbaik in-sample (min 51 trade) — JANGAN dipercaya sebelum lihat walk-forward

| Rule | hasil |
|---|---|
| jup_buy_sell_ratio_5m ≥ 2.1 | 64 trade · mean 8.9% · median 4% · win 59.4% · puncak≥25% 45.3% · kena SL 12.5% |
| jup_buy_sell_ratio_5m ≥ 1.73 | 126 trade · mean 5.8% · median 1.2% · win 53.2% · puncak≥25% 42.1% · kena SL 22.2% |
| dev_created_count ≤ 1 | 62 trade · mean 4.8% · median -1.5% · win 46.8% · puncak≥25% 41.9% · kena SL 21% |
| jup_buy_sell_ratio_5m ≥ 1.53 | 188 trade · mean 4.8% · median 0.6% · win 52.1% · puncak≥25% 39.9% · kena SL 25% |
| top10_pct ≥ 24.44 | 73 trade · mean 3.6% · median -0.6% · win 47.9% · puncak≥25% 38.4% · kena SL 34.2% |

### Walk-forward pemilihan rule (4 fold, anchored)

| Fold | rule terpilih (dari data lampau) | latih mean | uji: rule | uji: tanpa filter |
|---|---|---|---|---|
| 1 | jup_buy_sell_ratio_5m ≥ 1.64 | 12.2% (26) | 8.1% (39) | -1.2% (128) |
| 2 | jup_buy_sell_ratio_5m ≥ 1.77 | 10.5% (50) | -4.7% (10) | -4.2% (128) |
| 3 | dev_created_count ≤ 1 | 9.1% (33) | -1.6% (10) | -3.4% (128) |
| 4 | jup_buy_sell_ratio_5m ≥ 2.07 | 10.3% (51) | 2.7% (17) | -2.7% (131) |

**Out-of-sample gabungan:** dengan rule → 76 trade · mean 3.9% · median -0.7% · win 48.7% · puncak≥25% 35.5% · kena SL 21.1%

**Out-of-sample tanpa filter:** 515 trade · mean -2.9% · median -4.7% · win 35.5% · puncak≥25% 26.6% · kena SL 36.7%

Rule paling sering terpilih: `jup_buy_sell_ratio_5m ≥ 1.64`

## Edge di token likuid (likuiditas saat evaluasi ≥ $30k)

Kesimpulan otomatis: **ada edge** hanya kalau walk-forward out-of-sample punya mean > 0 dan median > −2% dari ≥ 30 trade.

### Semua sumber

**Tanpa filter tambahan:** 347 trade · mean -7.3% · median -5.2% · win 25.6% · puncak≥25% 15.6% · kena SL 19%

Walk-forward rule: fold 1: `top_holders_pct ≥ 14.66` → -5.7% (n 30) · fold 2: `fresh_wallet_pct ≤ 0.05` → -39.3% (n 5) · fold 3: `smart_wallets ≤ 0` → -7.6% (n 3) · fold 4: `smart_wallets ≤ 0` → -21.2% (n 6)

**OOS dengan rule:** 44 trade · mean -11.7% · median -7.2% · win 18.2% · puncak≥25% 9.1% · kena SL 29.5% · **OOS tanpa filter:** 278 trade · mean -6.5% · median -4.3% · win 26.3% · puncak≥25% 15.1% · kena SL 20.1%

**Kesimpulan: ❌ tidak ada edge** — OOS mean -6.5% / median -4.3% dari 278 trade

### Migrasi

**Tanpa filter tambahan:** 142 trade · mean -9.7% · median -7.4% · win 28.2% · puncak≥25% 23.9% · kena SL 21.8%

Walk-forward rule: fold 1: `buy_sell_ratio_5m ≥ 7.33` → -8.2% (n 4) · fold 2: `liquidity_usd ≤ 49.7rb` → -19.9% (n 11) · fold 3: `smart_wallets ≤ 0` → -17.4% (n 2) · fold 4: `dev_pct ≥ 79.32 & top_holders_pct ≥ 93` → –% (n 0)

**OOS dengan rule:** 17 trade · mean -16.8% · median -8.4% · win 5.9% · puncak≥25% 5.9% · kena SL 41.2% · **OOS tanpa filter:** 114 trade · mean -10.4% · median -7.4% · win 27.2% · puncak≥25% 25.4% · kena SL 24.6%

**Kesimpulan: ❌ tidak ada edge** — OOS mean -10.4% / median -7.4% dari 114 trade

### DexScreener

**Tanpa filter tambahan:** 40 trade · mean -7.5% · median -8.2% · win 20% · puncak≥25% 12.5% · kena SL 32.5%

Walk-forward rule: fold 1: `buy_sell_ratio_5m ≥ 0.55` → -9.7% (n 8) · fold 2: `price_change_5m ≤ 12.57` → -9.9% (n 4) · fold 3: `jup_buy_sell_ratio_5m ≤ 3.3 & price_change_5m ≤ 20.6` → -7.6% (n 3) · fold 4: `liquidity_usd ≥ 83.9rb` → -1.2% (n 2)

**OOS dengan rule:** 17 trade · mean -8.4% · median -4.2% · win 17.6% · puncak≥25% 5.9% · kena SL 23.5% · **OOS tanpa filter:** 32 trade · mean -7.2% · median -7.8% · win 21.9% · puncak≥25% 12.5% · kena SL 34.4%

**Kesimpulan: ❌ tidak ada edge** — OOS mean -7.2% / median -7.8% dari 32 trade

### Smart money

**Tanpa filter tambahan:** 117 trade · mean -4.1% · median -2.1% · win 26.5% · puncak≥25% 6% · kena SL 15.4%

Walk-forward rule: fold 1: `age_min ≥ 57.44` → -3.3% (n 9) · fold 2: `buy_sell_ratio_5m ≥ 1.99` → 0.5% (n 3) · fold 3: `buy_sell_ratio_5m ≥ 1.82` → –% (n 0) · fold 4: `buy_sell_ratio_5m ≥ 2.17` → -4.7% (n 1)

**OOS dengan rule:** 13 trade · mean -2.5% · median -1.1% · win 38.5% · puncak≥25% 7.7% · kena SL 15.4% · **OOS tanpa filter:** 94 trade · mean -4.1% · median -2.1% · win 24.5% · puncak≥25% 5.3% · kena SL 14.9%

**Kesimpulan: ❌ tidak ada edge** — OOS mean -4.1% / median -2.1% dari 94 trade

## Uji waktu entry (semua trigger yang punya jalur harga, tanpa filter)

Masuk N menit setelah trigger, exit quick_flip, biaya 2%+2%. Sampel jauh lebih besar daripada token yang dievaluasi pipeline.

### Token baru (4132 trigger)

| Masuk setelah | trade | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0.5 menit | 4130 | -13.4% | -9.4% | 9.4% | 8.9% | 23.2% |
| 2 menit | 3907 | -12% | -9.3% | 5.2% | 4.9% | 13.9% |
| 5 menit | 3743 | -10.3% | -9.3% | 3% | 2.8% | 6.4% |
| 10 menit | 3529 | -9.7% | -9.3% | 1.9% | 1.6% | 3.1% |
| 15 menit | 3391 | -9.8% | -9.3% | 1.2% | 1% | 2.3% |
| 20 menit | 3341 | -9.6% | -9.3% | 0.9% | 0.7% | 1.6% |

Walk-forward pilihan delay: fold 1: 15 mnt → -9.8% (n 787) · fold 2: 20 mnt → -9.2% (n 779) · fold 3: 20 mnt → -9.7% (n 792) · fold 4: 20 mnt → -9.6% (n 736)

**OOS delay terpilih:** 3094 trade · mean -9.6% · median -9.3% · win 0.9% · puncak≥25% 0.8% · kena SL 1.7% · **OOS masuk 0,5 menit:** 3306 trade · mean -13.5% · median -9.5% · win 9.6% · puncak≥25% 9.5% · kena SL 24.4%

### Migrasi (234 trigger)

| Masuk setelah | trade | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0.5 menit | 228 | -12.9% | -9.3% | 33.3% | 27.6% | 36.8% |
| 2 menit | 218 | -10.9% | -8.6% | 33.5% | 32.1% | 33.5% |
| 5 menit | 209 | -13.7% | -9.6% | 29.2% | 27.3% | 34% |
| 10 menit | 193 | -13.7% | -10.8% | 23.3% | 22.3% | 29% |
| 15 menit | 182 | -16.5% | -10.9% | 17% | 14.3% | 29.7% |
| 20 menit | 174 | -13.7% | -10.9% | 13.8% | 12.6% | 25.9% |

Walk-forward pilihan delay: fold 1: 5 mnt → -21.7% (n 45) · fold 2: 20 mnt → -10.4% (n 35) · fold 3: 20 mnt → -13.3% (n 40) · fold 4: 20 mnt → -17.5% (n 42)

**OOS delay terpilih:** 162 trade · mean -16.1% · median -10.9% · win 13% · puncak≥25% 11.7% · kena SL 29% · **OOS masuk 0,5 menit:** 183 trade · mean -13.1% · median -9.1% · win 33.3% · puncak≥25% 29.5% · kena SL 37.2%

### DexScreener (337 trigger)

| Masuk setelah | trade | mean PnL | median | win | puncak≥25% | kena SL |
|---|---|---|---|---|---|---|
| 0.5 menit | 336 | -8.8% | -9.4% | 25.6% | 19.6% | 45.5% |
| 2 menit | 336 | -7.1% | -8.1% | 27.7% | 21.4% | 39% |
| 5 menit | 326 | -10% | -6.5% | 23.6% | 16% | 37.7% |
| 10 menit | 310 | -9.3% | -7.8% | 19.7% | 12.9% | 33.9% |
| 15 menit | 304 | -9.2% | -6.6% | 14.5% | 9.9% | 28.9% |
| 20 menit | 295 | -7.1% | -6% | 16.6% | 9.2% | 23.7% |

Walk-forward pilihan delay: fold 1: 2 mnt → -7.6% (n 67) · fold 2: 20 mnt → -8.8% (n 64) · fold 3: 20 mnt → -7.4% (n 66) · fold 4: 20 mnt → -7.2% (n 56)

**OOS delay terpilih:** 253 trade · mean -7.7% · median -6.3% · win 19% · puncak≥25% 12.3% · kena SL 30% · **OOS masuk 0,5 menit:** 270 trade · mean -9.2% · median -9.2% · win 25.2% · puncak≥25% 18.9% · kena SL 45.9%

## Biaya eksekusi terukur (cost probe: quote beli → jual Jupiter, termasuk biaya jaringan)

| Likuiditas | probe | median round-trip | p75 |
|---|---|---|---|
| < $10rb | 744 | 3.71% | 5.00% |
| $10–30rb | 168 | 3.15% | 3.46% |
| $30–50rb | 66 | 2.68% | 2.99% |
| $50–100rb | 44 | 2.64% | 2.73% |
| ≥ $100rb | 48 | 1.21% | 1.55% |

## Sensitivitas biaya (masuk 0,5 menit setelah trigger, tanpa filter)

Biaya round-trip = entry + exit (fee pool/platform + price impact + jaringan). Token likuid pasca-migrasi realistis ±1–2%, token bonding curve baru ±3–5%.

| Sumber | biaya 1% | biaya 2% | biaya 3% | biaya 4% |
|---|---|---|---|---|
| Token baru | -11.2% (med -6.8%) | -12% (med -7.8%) | -12.9% (med -8.8%) | -13.7% (med -9.7%) |
| Migrasi | -9.4% (med -6.5%) | -10.3% (med -7.5%) | -12.2% (med -8.7%) | -12.9% (med -9.6%) |
| DexScreener | -5.9% (med -5.1%) | -6.8% (med -6.7%) | -8.2% (med -8.1%) | -8.8% (med -9.5%) |
