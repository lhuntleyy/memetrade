# Decision Log (ADR singkat)

Format: ID · tanggal · status (proposed / accepted / superseded) · keputusan · alasan · alternatif.

---

### ADR-001 · 2026-10-17 · proposed — TypeScript + Bun untuk seluruh sistem
- **Keputusan:** Bot core, dashboard, LLM worker, CLI semua TypeScript di Bun 1.4.
- **Alasan:** permintaan user (Bun cepat), satu bahasa, ekosistem SDK Solana paling lengkap di TS, Bun punya Postgres/Redis/WebSocket/bundler bawaan.
- **Alternatif:** Python (pandas enak untuk riset, tapi dua bahasa), Rust (paling cepat, tapi lambat dikembangkan).

### ADR-002 · 2026-10-17 · proposed — PostgreSQL + TimescaleDB native, tanpa Redis/Docker di awal
- **Keputusan:** Postgres 17 + Timescale via apt; event bus in-memory di core; tanpa Redis/Docker sampai butuh.
- **Alasan:** RAM 2 GB; continuous aggregate = candle multi-TF gratis; satu sumber kebenaran.
- **Alternatif:** SQLite (paling ringan, tapi concurrency & time-series terbatas), ClickHouse (berat), Redis pub/sub (tambah komponen).

### ADR-003 · 2026-10-17 · proposed — Modular monolith untuk core
- **Keputusan:** collector→engine→executor→exit dalam satu proses `memebot-core`; dashboard & LLM worker proses terpisah.
- **Alasan:** latency terendah, RAM hemat, debugging gampang; modul tetap terpisah per interface agar bisa dipecah nanti.

### ADR-004 · 2026-10-17 · proposed — LLM di luar jalur panas
- **Keputusan:** LLM hanya async (tagger, parser, review, veto profil lambat). Tidak pernah memicu beli/jual atau mengubah risk.
- **Alasan:** latency, biaya, non-determinisme, prompt injection; bukti Alpha Arena (>50% LLM rugi saat trading langsung).

### ADR-005 · 2026-10-17 · proposed — Jupiter Swap API V2 sebagai jalur eksekusi default
- **Keputusan:** `/order` + `/execute` default; `/build` + Helius Sender untuk kontrol fee/exit panic; pump SDK langsung sebagai fallback.
- **Alasan:** Ultra V1 deprecated; V2 menyatukan routing (Metis, JupiterZ, Dflow, OKX) + landing terkelola.
- **Catatan:** platform fee 50 bps untuk token < 24 jam → bandingkan net vs jalur langsung saat paper.

### ADR-006 · 2026-10-17 · proposed — Harga real-time dari stream + quote lokal
- **Keputusan:** monitoring posisi pakai trade stream / `accountSubscribe` pool dan hitung nilai jual dari reserve; Jupiter quote hanya saat eksekusi & paper fill.
- **Alasan:** polling 2–5 dtk terlalu lambat untuk memecoin; free tier Jupiter 1 RPS.

### ADR-007 · 2026-10-17 · proposed — Observasi dulu, strategi kemudian
- **Keputusan:** Fase 1 hanya collector + tracker + Trigger Lab, tanpa logika beli.
- **Alasan:** poin terkuat dari post referensi; mencegah tuning berbasis feeling.

### ADR-008 · 2026-10-17 · proposed — Dashboard privat via Tailscale
- **Keputusan:** dashboard tidak punya port publik; akses lewat Tailscale; TOTP untuk aksi berbahaya.
- **Alasan:** dashboard bisa mengontrol wallet berisi uang.

### ADR-009 · 2026-10-17 · accepted — Migrasi SQL murni + runner sendiri (bukan drizzle-kit)
- **Keputusan:** skema di `packages/db/migrations/NNNN_*.sql`, dijalankan `bun run db:migrate` (checksum, satu transaksi per file). Query pakai `Bun.SQL` langsung.
- **Alasan:** hypertable, continuous aggregate, kompresi & retensi Timescale = SQL khusus yang tidak dimodelkan drizzle-kit; satu dependency lebih sedikit.
- **Catatan:** Drizzle bisa ditambah nanti hanya untuk typed query kalau query makin banyak.

### ADR-010 · 2026-10-17 · accepted — Tooling: TypeScript 7, Biome 2.5, zod 4
- `tsc` hanya untuk typecheck (Bun yang menjalankan TS), Biome untuk format + lint (preset recommended, `noNonNullAssertion` off karena `noUncheckedIndexedAccess` aktif), zod 4 untuk schema config.

### ADR-011 · 2026-10-17 · accepted — Fase 1: harga via polling DexScreener, dashboard vanilla TS
- **Keputusan:** sumber harga tracker sementara = DexScreener `/tokens/v1` (gratis, ≤30 mint/request, 300 rpm). Dashboard Fase 1 = `Bun.serve` + TypeScript vanilla (tanpa Elysia/React dulu).
- **Alasan:** belum ada API key RPC/trade stream; 3 halaman masih sederhana. Elysia + React dipakai saat halaman interaktif (positions, config editor) masuk di Fase 3.
- **Konsekuensi:** tick ±2–5 dtk, telat index ±1 menit untuk token baru; candle dari `trades_raw` belum terisi. Diganti/ditambah sumber on-chain begitu `HELIUS_API_KEY` ada.
- **Referensi return Trigger Lab** = harga pasar pertama yang teramati (bukan harga create), lihat migrasi 0002.
