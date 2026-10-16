# 05 — Risk Management & Eksekusi

## 1. Risk manager (gerbang terakhir sebelum order)

```yaml
# config/trade.example.yaml
mode: paper                     # paper | live  (global; profile bisa lebih ketat, tidak bisa lebih longgar)
bankroll:
  reference_sol: 2.0            # modal acuan untuk % limit
  min_sol_reserve: 0.15         # sisa SOL untuk fee/rent; di bawah ini → stop entry
limits:
  max_open_positions: 6
  max_open_per_profile: 3
  max_position_sol: 0.25
  max_exposure_sol: 1.0         # total SOL di posisi terbuka
  max_trades_per_day: 120
  reentry_cooldown_min: 30      # token yang sama
  no_averaging_down: true
daily:
  max_loss_sol: 0.3             # ~15% bankroll → stop entry sampai 00:00 UTC
  profit_lock_sol: 0.6          # opsional: setelah profit X, kecilkan size 50% / stop
  profit_lock_action: halve_size  # stop | halve_size | none
trading_hours_utc:              # diisi dari heatmap Trigger Lab
  enabled: false
  allow: ["00:00-04:00", "12:00-18:00"]
circuit_breakers:
  consecutive_losses: { n: 5, pause_min: 30 }
  drawdown_from_peak_pct: { value: 25, action: pause_profile }
  data_stale_sec: 10            # tick/provider basi → no new entries
  provider_error_rate: { window_min: 5, max_pct: 30 }
  rpc_latency_ms_p95: 1500
  exec_fail_rate: { window: 10, max_pct: 40 }
  slippage_anomaly: { window: 10, avg_extra_bps: 300 }
execution:
  default_route: jupiter_v2_order       # jupiter_v2_order | jupiter_v2_build | pump_direct
  fallback_route: pump_direct
  slippage_bps_entry: 800               # kalau pakai mode manual; default RTSE Jupiter
  priority_fee_lamports: { entry: 100000, exit: 150000, panic_max: 2000000 }
  tip_lamports: { entry: 10000, exit: 10000 }
  max_fee_pct_of_trade: 2.0             # total network fee > 2% dari nominal → batal
  sender: { url: "http://sg-sender.helius-rpc.com/fast", swqos_only: true, mev_protect: true, fallback_region: tokyo }
  close_ata_after_exit: true
  confirm_timeout_ms: 20000
kill_switch:
  file_flag: /run/memebot/KILL          # ada file ini = stop entry
  telegram_admin_chat_ids: []
```

### Aturan main
- **Kill** = stop entry baru, posisi tetap dikelola exit engine. **Panic** = kill + jual semua posisi (mode panic).
- Mode global `paper` mengalahkan profile `live` (nggak bisa live tanpa sengaja).
- Ganti `mode: live` wajib lewat konfirmasi (dashboard + TOTP / perintah CLI), tercatat di `control_events`.
- Semua limit dievaluasi **sebelum** order; hasil penolakan dicatat sebagai `Decision(stage=risk)`.

## 2. Ekonomi trade (hitung sebelum mimpi)

Biaya round-trip realistis memecoin post-migrasi via Jupiter V2: **±3–8%** (detail di `01-review-post.md §2`). Konsekuensi:

| Kalau rata-rata win | rata-rata loss (realisasi) | biaya | win rate minimal |
|---|---|---|---|
| +20% | −15% | 5% | 57% |
| +30% | −15% | 4% | 42% |
| +50% | −20% | 4% | 34% |

Cara menekan biaya:
1. **Ukuran posisi vs likuiditas** — `max_price_impact_pct` dihitung dari reserve sebelum order.
2. **Jalur langsung (pump SDK)** untuk token bonding curve / PumpSwap — tanpa platform fee aggregator. Bandingkan net out tiap jalur saat paper.
3. **Tip SWQoS-only** (0.000005 SOL min) untuk entry yang nggak buru-buru; tip/priority tinggi hanya untuk exit panic.
4. **Selalu close ATA** setelah posisi habis → rent 0.00203928 SOL balik.
5. **Kurangi trade jelek, bukan perbanyak trade** — 20 trade bagus > 80 trade setengah matang.

## 3. Eksekusi live

### Jalur default: Jupiter Swap API V2
```
GET  https://api.jup.ag/swap/v2/order?inputMint=SOL&outputMint=<mint>&amount=<lamports>&taker=<wallet>
     header x-api-key
     → { transaction (base64), requestId, outAmount, router, feeBps, ... }
sign transaction (lokal)
POST https://api.jup.ag/swap/v2/execute  { signedTransaction, requestId }
     → { status, signature, totalInputAmount, totalOutputAmount, ... }
```
- Tanpa `taker` → quote saja (dipakai paper trading & round-trip check).
- Default slippage = RTSE (otomatis). Isi `slippageBps` hanya untuk exit panic.
- Rate limit: free key **1 RPS** untuk endpoint umum, `/execute` bucket sendiri (free 50 RPS). → Quote Jupiter **bukan** untuk monitoring harga.

### Jalur alternatif
- **`/build`** → dapat instruksi/tx, set priority fee & tip sendiri, kirim via **Helius Sender** (SG). Kontrol penuh, cocok untuk exit panic.
- **Pump direct** (SDK resmi pump.fun / PumpSwap) → token di bonding curve, dan **fallback exit** kalau Jupiter error/timeout.

### Siklus order
1. `client_id` unik (idempoten) → simpan `orders(status=CREATED)`.
2. Re-quote tepat sebelum kirim; batal kalau harga sudah lari > X% dari sinyal (entry) — exit tidak pernah dibatalkan.
3. Kirim → `SENT` → tunggu konfirmasi (WS `signatureSubscribe` + polling `getSignatureStatuses` cadangan).
4. Parse tx: `preTokenBalances/postTokenBalances` + delta SOL → **fill aktual** (harga, fee network, rent). Simpan `fills`, hitung `quote_vs_fill_bps`.
5. Gagal → entry: tidak di-retry otomatis kecuali error jaringan & harga masih valid; exit: retry bertingkat (slippage & priority naik, ganti jalur) sampai `retries` habis → alert Telegram.
6. Posisi habis → close ATA (bisa di-batch).

## 4. Paper trading realistis

Masalah dry run naif: fill di harga saat sinyal, tanpa fee, tanpa gagal. Paper kita:

| Aspek | Simulasi |
|---|---|
| Latency | Tunda keputusan → fill sebesar `latency_ms` (default 900 ms; nanti pakai distribusi dari data live) |
| Harga entry | **Quote Jupiter V2 beneran** (tanpa taker) untuk jumlah persis, diambil setelah delay; kalau rate limit → quote lokal dari reserve + penalti |
| Harga exit | Quote lokal dari reserve (price impact sesuai jumlah token) setelah delay, + penalti slippage tambahan saat exit panic |
| Fee | network (base + priority + tip) + platform fee Jupiter (10/50 bps) + fee pool + rent ATA (refund saat close) |
| Gagal tx | Probabilitas `p_fail` (default entry 8%, exit 5%); exit gagal → coba lagi tick berikutnya (harga bisa makin jelek) |
| Partial fill | Tidak (swap atomic), tapi slippage bisa bikin out lebih kecil |
| Kalibrasi | Saat micro-live, bandingkan `paper_fill` vs `live_fill` per trade → update parameter simulasi |

## 5. Tangga go-live

| Tahap | Syarat masuk | Ukuran | Durasi minimal |
|---|---|---|---|
| Paper | — | virtual | ≥ 300 trade per profile |
| **Micro live** | Lolos kriteria go-live (`09-evaluation.md`) | 0.01–0.03 SOL/trade, bankroll 0.5–1 SOL | ≥ 100 trade live |
| Small live | Live vs paper selisih fee+slippage ≤ 20%, PF live ≥ 1.2 | 0.05–0.1 SOL | 2 minggu |
| Scale | Metrik stabil 2 minggu | naik maks 2× per minggu | — |

Turun tahap otomatis kalau: drawdown > batas, PF 100 trade terakhir < 1.0, atau insiden eksekusi.

## 6. Keamanan wallet & operasional

- **Hot wallet khusus bot**, isi seperlunya. Jangan pakai wallet utama/seed utama.
- Private key format base58 di `/etc/memebot/secrets.env` (chmod 600, owner `memebot`), dibaca hanya oleh core. Opsi lanjut: keystore terenkripsi + passphrase saat start.
- Sweep profit ke wallet dingin (manual atau perintah CLI dengan konfirmasi).
- Backup harian DB (pg_dump + restic ke storage eksternal) — tidak berisi private key.
- Alert Telegram untuk: order gagal beruntun, circuit breaker, saldo SOL < reserve, service restart, disk > 80%.
- Uji kill switch & panic tiap kali deploy versi baru (di paper).
