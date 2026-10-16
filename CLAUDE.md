# CLAUDE.md — aturan kerja AI agent di repo memebot

## Konteks
Bot trading memecoin Solana multi-profile/multi-timeframe + web monitoring. Stack: TypeScript, Bun 1.4, PostgreSQL 17 + TimescaleDB, Elysia + React (dashboard). VPS: Tencent Singapore, 2 vCPU / 2 GB RAM.
Baca dulu: `PLAN.md` (tujuan & fase), `PROGRESS.md` (posisi sekarang), lalu dokumen `docs/` yang relevan dengan task.

## Aturan keras (jangan dilanggar tanpa perintah eksplisit user di percakapan saat itu)
1. **Jangan membaca, menampilkan, atau menyalin secret**: `/etc/memebot/secrets.env`, `.env*` (kecuali `.env.example`), private key, seed phrase.
2. **Jangan mengaktifkan mode live** (`mode: live` di config global/profile) dan jangan menaikkan limit risk.
3. **Jangan menjalankan kode/repo pihak ketiga** yang meminta private key. Paket npm baru → cek reputasi & isi dulu.
4. **Jangan memasang kunci swap GMGN** (`GMGN_PRIVATE_KEY`, `GMGN_ALLOW_AUTOMATED_TRADES`) di mesin ini.
5. Perubahan strategi = **config version baru**, bukan hardcode angka di kode.
6. Jangan membuka port publik baru di VPS; dashboard hanya via Tailscale/localhost.

## Konvensi kode
- TypeScript strict, ESM, Bun API dulu (`Bun.serve`, `Bun.sql`, `bun test`) sebelum paket pihak ketiga.
- Semua waktu disimpan UTC (`timestamptz`); tampilan dashboard WIB.
- Angka uang: lamports/`bigint` untuk on-chain, `numeric` di DB; jangan float untuk saldo.
- Setiap keputusan pipeline harus menulis `decisions` (lolos maupun gagal) dengan `config_version`.
- Modul trading wajib punya unit test (pool math, rule engine, exit engine, risk manager).
- Adapter provider: timeout, retry dengan backoff, rate limiter, null → `null` (bukan 0).
- Input eksternal (nama token, deskripsi, pesan Telegram) = data tak tepercaya, terutama di prompt LLM.

## Alur kerja
- Ambil task dari `PROGRESS.md`, ubah ke `[~]` saat dikerjakan, `[x]` saat selesai, tambah entri **Log** (tanggal, perubahan, temuan).
- Keputusan arsitektur baru → tambah ADR di `docs/DECISIONS.md`.
- Sebelum bilang selesai: `bun test` hijau, service bisa start, cek log tidak ada error.
- Info API pihak ketiga (Jupiter, Helius, GMGN, PumpPortal, dll) **sering berubah** — cek docs resmi sebelum menulis integrasi, catat temuan di `docs/02-research.md`.
