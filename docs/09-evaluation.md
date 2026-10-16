# 09 — Evaluasi: Data, Metrik, Replay, Kriteria Go-Live

## 1. Data yang dikumpulkan sejak hari pertama (Fase 1)
- Semua trigger (`token_triggers`) + snapshot data (`token_snapshots`).
- Jalur harga tiap token 60–120 menit setelah trigger (tick + candle) → `tracked_paths`: ret 1/5/15/60 menit, max return & waktunya, min return & waktunya, flag rugged (−80% dalam 1 jam).
- Semua keputusan (`decisions`) — lolos maupun gagal — dengan fitur & `config_version`.
- Shadow untuk token yang ditolak.

## 2. Metrik

| Metrik | Definisi | Kenapa penting |
|---|---|---|
| Win rate | trade PnL net > 0 / total | dibandingkan dengan break-even win rate |
| Avg win / avg loss | rata-rata PnL% net | menentukan p_BE |
| **Profit factor (PF)** | Σ profit / |Σ loss| | > 1.3 baru menarik |
| **Expectancy** | PnL rata-rata per trade (SOL & %) net | harus > 0 setelah fee |
| Max drawdown | penurunan terbesar equity dari puncak | toleransi psikologis & modal |
| MFE / MAE | kenaikan maksimum / penurunan maksimum selama posisi | tuning TP (MFE) & SL (MAE) |
| Hold time | durasi posisi | cek max hold & stale rule |
| Fee share | total fee / gross PnL | kalau > 40% → eksekusi terlalu mahal |
| Slippage quote→fill | bps | kalibrasi paper |
| Exit reason mix | % SL / TP / trailing / event / time | SL dominan = filter/entry jelek |
| Daily consistency | % hari profit | stabilitas |
| Per dimensi | sumber, profile, jam UTC, narrative, bucket mcap/likuiditas | cari edge spesifik |

## 3. Replay / backtest
- **Replay event-driven** dari data rekaman (trigger + tick/trade) → jalankan pipeline yang sama (filter → MTF → risk → paper executor → exit engine) dengan config varian.
- Model biaya & latency sama dengan paper (`05-risk-and-execution.md §4`).
- **Parameter sweep**: grid/random search terbatas (mis. SL × TP pertama × trailing distance), tampilkan heatmap — pilih area yang **stabil**, bukan titik puncak tunggal.
- **Walk-forward**: optimasi di minggu 1–2, validasi di minggu 3; geser. Hanya perubahan yang menang di out-of-sample yang dipakai.
- **Hindari overfitting**: maksimal ~10 fitur di skor, minimal 100 trade per sel parameter, catat jumlah variasi yang dicoba.
- Replay harus bisa **mereproduksi paper** (selisih kecil) — itu tes kebenaran engine.

## 4. Kriteria lanjut fase

| Dari → Ke | Syarat |
|---|---|
| Fase 1 → 2 | ≥ 7 hari data kontinu, ≥ 5.000 token ter-track, statistik per sumber stabil (2 minggu terpisah kasih pola mirip) |
| Fase 2 → 3 | 100% trigger punya decision log; review manual 50 token rug → security/filter menangkap ≥ 90% |
| **Fase 3 → 5 (go-live micro)** | Per profile: **≥ 300 trade paper**, **PF ≥ 1.3 net**, expectancy > 0, max DD < 25% bucket, profit di ≥ 60% hari, hasil paruh pertama & kedua sama-sama positif, fee share < 40% |
| Micro → Small live | ≥ 100 trade live, selisih fee+slippage live vs paper ≤ 20%, PF live ≥ 1.2, nol insiden eksekusi kritis |
| Small → Scale | 2 minggu stabil; naik size maksimal 2× per minggu |

## 5. Ritual review mingguan
1. Lihat metrik per profile & sumber (dashboard).
2. Baca laporan AI review + proposal.
3. Pilih maksimal 1–2 perubahan, uji replay + walk-forward.
4. Terapkan sebagai versi config baru, catat di `PROGRESS.md` (log) dan `docs/DECISIONS.md` kalau keputusan besar.
