# Kalibrasi backtest vs paper trading (2026-10-18T17:03 UTC, 72 jam)

Posisi paper tutup: 161, bisa di-replay: 150. Replay = exit engine & config yang sama, entry di waktu order beli paper (+1 dtk), biaya terukur per likuiditas.

- Slippage entry paper vs harga DexScreener (median): 0.71% (61 trade)
- Alasan exit sama di paper & replay: 50.67%

## Sebelum kalibrasi

Replay mentah (tanpa batas TP): paper -5.18% vs replay 1.46% → selisih -6.64 poin. Di bawah ini profit replay sudah dibatasi di level TP.

Rata-rata PnL/trade: **paper -5.18%** vs **replay -1.85%** → selisih -3.33 poin

| Alasan exit (paper) | n | paper | replay | selisih |
|---|---|---|---|---|
| momentum_fail | 80 | -3% | -3.81% | 0.81 |
| hard_sl | 35 | -37.86% | -14.87% | -22.99 |
| take_profit | 17 | 32.15% | 26.72% | 5.43 |
| trailing | 13 | 18.33% | 8.88% | 9.45 |
| stale | 5 | 0.49% | -4.58% | 5.06 |

## Gap exit hasil kalibrasi (poin % tambahan rugi di replay)

- `data_end`: 11.1
- `momentum_fail`: 0.8
- `take_profit`: 12.1

## Validasi silang (gap dari separuh pertama, diuji di separuh kedua)

Gap separuh pertama: {"data_end":13,"momentum_fail":4,"take_profit":13.2}

Separuh kedua: paper -5.52% · replay tanpa koreksi -4.56% · gap per alasan -11.39% · potongan rata 5.7 poin → -10.25% (n 75)

Per kelompok sumber (separuh kedua): error tertimbang tanpa koreksi 3.96 → dengan potongan per sumber 3.22 · potongan dari separuh pertama: {"migration":5.7,"dexscreener":2.6,"new_token":5.7,"wallet":0} · rata-rata total -5.5%

Error |replay − paper| di separuh kedua: tanpa koreksi 0.96 · gap per alasan 5.87 · potongan rata 4.73 → **metode terpilih: source**

## Sesudah kalibrasi (semua trade)

Rata-rata PnL/trade: paper -5.18% vs replay terkalibrasi **-4.87%** → selisih -0.32 poin

Potongan per sumber (semua data): {"migration":7.3,"dexscreener":1.9,"new_token":5.7,"wallet":0}

| Kelompok sumber | n | paper | replay sebelum | replay sesudah |
|---|---|---|---|---|
| migration | 58 | -8.98% | 0.8% | -6.5% |
| dexscreener | 6 | -9.82% | -1.4% | -3.3% |
| new_token | 3 | -46.04% | -2.53% | -8.23% |
| wallet | 83 | -0.72% | -3.71% | -3.71% |

## 10 trade dengan selisih terbesar

| id | profile | mint | paper | alasan paper | replay | alasan replay |
|---|---|---|---|---|---|---|
| 55 | explore_migration | `CrequX…` | -92.8% | hard_sl | 15.2% | data_end |
| 197 | explore_migration | `3zM1DE…` | -93.1% | hard_sl | 9.0% | data_end |
| 227 | explore_migration | `JqY4bR…` | -96.0% | hard_sl | 4.6% | data_end |
| 109 | explore_new_token | `XZxiFW…` | -57.8% | hard_sl | 30.0% | take_profit |
| 49 | explore_migration | `986hhQ…` | -71.5% | hard_sl | 16.2% | data_end |
| 37 | explore_migration | `HSnJNb…` | -82.3% | hard_sl | 4.6% | momentum_fail |
| 50 | explore_migration | `2LQX8b…` | -77.0% | hard_sl | -3.1% | data_end |
| 34 | explore_trending | `HmqnR7…` | -27.7% | hard_sl | 30.0% | take_profit |
| 44 | explore_new_token | `Hn89zq…` | -17.8% | hard_sl | 30.0% | take_profit |
| 155 | smart_money | `HS1f1H…` | -15.4% | hard_sl | 30.0% | take_profit |
