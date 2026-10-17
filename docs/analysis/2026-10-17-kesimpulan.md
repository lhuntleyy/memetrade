# Kesimpulan analisa fitur & usulan filter — 2026-10-17

Data: ±9 jam (22:56 → 07:55 UTC), 6.138 token dievaluasi (1.086 punya harga setelah entry), 1.789 trigger dengan jalur
harga 90 menit. Target: PnL replay exit `quick_flip` setelah biaya. Laporan lengkap: `2026-10-17-fitur.md`
(dibuat dengan `bun run apps/cli/src/main.ts analyze 24 <file>`).

## Temuan

1. **Belum ada filter yang lolos walk-forward.** Rule terbaik in-sample per sumber (mis. token baru `mcap ≤ $2,9k`
   +3,7%/trade, migrasi `age_min ≤ 1,35 & dev_pct ≥ 0,4` +12%/trade) ambruk di out-of-sample:
   token baru −4,2% vs −4,4% tanpa filter; migrasi −4,8% vs −5,1%; DexScreener −5,1% vs −5,2%.
   Dengan 9 jam data, pemilihan rule masih menangkap noise.
2. **Token baru pump.fun negatif di semua kondisi**: semua delay entry (0,5–20 menit) dan semua level biaya
   (bahkan biaya 1% → −1,8%/trade). Win rate 2–10%, puncak ≥ +25% hanya 1–8%.
3. **"Masuk lebih lambat" ternyata bias seleksi.** Di data pipeline, token yang dievaluasi ≥ 10 menit setelah trigger
   tampak positif, tapi uji delay pada SEMUA trigger menunjukkan entry lambat tidak lebih baik (migrasi 10 menit −10,7%,
   DexScreener 10 menit −9,9%).
4. **Edge migrasi & DexScreener termakan biaya.** Median trade ≈ −biaya round-trip (mayoritas keluar flat lewat
   momentum-fail). Pada biaya 1%: migrasi +1,5%, DexScreener +3,3%/trade; biaya 2%: −0,6% / +1,1%; biaya 4%: −3,5% / −1,9%.
5. Petunjuk fitur (sampel kecil, ±10 per bucket — hipotesis, belum terbukti):
   - Migrasi: likuiditas GMGN ≥ ±$50k dan holder GMGN ≥ ±1.600 → mean ±0% dengan SL rate 0–10% (vs −11…−43% di bawahnya);
     banyak `smart_wallets` justru lebih jelek (kemungkinan mereka keluar ke kita).
   - DexScreener: dev serial deployer (`dev_created_count` > ±1.000 token) → −36%/trade, SL 86%.
6. Konfluensi smart money baseline terbaik (−0,2%/trade) tapi baru 43 trade.

## Usulan (semua tetap PAPER)

| # | Usulan | Alasan | Status |
|---|---|---|---|
| 1 | Matikan `explore_new_token` (`mode: off`) | Negatif di semua delay & biaya; menghabiskan kuota GMGN/Jupiter | menunggu persetujuan |
| 2 | Migrasi & DexScreener: wajib likuiditas tinggi (mis. `liquidity_usd ≥ 50000`) + tolak `dev_created_count > 1000` | Edge hanya ada kalau biaya rendah; likuiditas tinggi = price impact kecil | hipotesis, pantau di paper |
| 3 | Ukur biaya eksekusi nyata (quote beli→jual Jupiter untuk token pasca-migrasi, berbagai likuiditas) | Hasil sangat sensitif ke biaya 1–4%; perlu angka asli, bukan asumsi | belum dibuat |
| 4 | Ulangi `analyze` tiap ±24 jam; terapkan rule hanya kalau unggul di walk-forward 2× berturut-turut | Hindari overfitting | rutin |

**Tidak disarankan**: mengubah TP/SL lagi (walk-forward exit sebelumnya juga tidak menemukan edge) atau masuk live.
