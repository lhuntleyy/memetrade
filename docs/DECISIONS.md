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

### ADR-012 · 2026-10-17 · accepted — Akses dashboard via IP Tailscale + login
- **Keputusan:** dashboard bind ke IP tailnet (bukan publik, bukan `tailscale serve`), ufw allow 3000 hanya di `tailscale0`, plus login password (Argon2) + cookie session HMAC.
- **Alasan:** user tidak punya display di VPS; `tailscale serve` butuh aktivasi HTTPS di admin tailnet. Trafik tailnet sudah terenkripsi WireGuard.
- **Lanjutan:** kalau Serve/HTTPS diaktifkan, pindah ke `tailscale serve` + `DASHBOARD_SECURE_COOKIE=1`.

### ADR-013 · 2026-10-17 · accepted — Security via RPC jsonParsed, enrichment Jupiter keyless
- Mint/freeze authority & extension Token-2022 dibaca dari `getAccountInfo` encoding `jsonParsed` (RPC yang parse TLV) — tanpa parser biner sendiri. Extension tak dikenal = fail.
- RPC publik dipakai sementara (set `SOLANA_RPC_URL` ke Helius begitu ada key). Gagal RPC = fail (bukan pass).
- Pump.fun sekarang memakai Token-2022 dengan `metadataPointer` + `tokenMetadata` → dua extension ini dianggap aman.

### ADR-014 · 2026-10-17 · accepted — Proxy DexScreener mode fallback
- Proxy residential hanya dipakai saat IP VPS kena 429 (jeda direct 30 dtk→5 menit), bukan untuk semua request, karena biaya per GB (perkiraan mode always ±57 GB/bulan).

### ADR-015 · 2026-10-17 · accepted — Paper trading pakai quote Jupiter asli + PnL executable
- Fill paper = quote Jupiter Swap V2 untuk jumlah persis setelah delay latency; fallback estimasi constant product dari likuiditas DexScreener + fee konservatif (pool 1%, platform 0.5%).
- Harga entry efektif termasuk biaya jaringan & rent ATA; PnL monitoring = harga × (1 − estimasi biaya exit). Trailing/TP dalam poin persen.
- Entry ditolak kalau impact > `entry.max_price_impact_pct` (quote token baru bisa liar).
- Mode live sengaja ditolak sampai Fase 5.

### ADR-016 · 2026-10-17 · proposed — Dashboard publik via sslip.io + Caddy (menggantikan ADR-012 kalau diterapkan)
- User tidak mau Tailscale. Opsi: domain `43-156-246-199.sslip.io` → Caddy (HTTPS Let's Encrypt otomatis, HSTS) → dashboard 127.0.0.1:3000; login Argon2 + cookie Secure + throttle per IP (IP dari X-Forwarded-For hanya kalau datang dari Caddy lokal).
- Risiko: panel kontrol bot terekspos ke internet (dilindungi password 20 karakter acak + throttle). Diterapkan oleh user sendiri lewat `infra/scripts/enable-public-dashboard.sh`.

### ADR-017 · 2026-10-17 · accepted — Exit "quick flip" 20–30% jual semua (preferensi user)
- TP tunggal +30% (100%) + trailing aktif +20% jarak 4 poin. Tidak ada partial/moonbag. Bisa diubah di `exits.quick_flip`.
