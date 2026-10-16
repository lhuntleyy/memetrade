# 08 — Peran LLM

## 1. Prinsip
1. **LLM tidak pernah di jalur panas** (entry/exit detik-an). Latency 1–10 dtk, non-deterministik, dan bisa di-*prompt-inject* lewat nama/deskripsi token.
2. **LLM tidak pernah pegang kunci, tidak memanggil executor, tidak mengubah risk limit.**
3. Output LLM = **fitur/skor/proposal** dengan schema ketat (structured output). Kalau timeout/error → fitur dianggap `null` (filter yang pakai fitur ini harus `on_null: ignore` supaya bot tetap jalan).
4. Setiap fitur LLM harus **membuktikan nilai** lewat A/B di data (shadow): kalau tidak memperbaiki expectancy, dimatikan.
5. Semua input/output LLM dicatat (`llm_jobs`) untuk audit & hitung biaya.

## 2. Dua dunia LLM di proyek ini

### A. LLM sebagai builder (dev-time)
- Claude Code (yang lagi lo pakai sekarang) = partner riset + coding. Aturan kerjanya di `CLAUDE.md`.
- **GMGN skills** boleh dipasang untuk riset interaktif ("cek token X", "trending sekarang apa") — **tanpa** `GMGN_PRIVATE_KEY` dan **tanpa** `GMGN_ALLOW_AUTOMATED_TRADES` di mesin ini, supaya agent nggak bisa swap.
- Jupiter (Jul 2026) juga punya hosted Trading MCP untuk agent — sama, hanya untuk riset read-only.

### B. LLM di runtime (async, `memebot-llm` worker)

| # | Tugas | Input | Output (schema) | Kapan | Dipakai untuk |
|---|---|---|---|---|---|
| 1 | **Narrative tagger** | simbol & nama **tersanitasi**, deskripsi (dipotong), domain sosial, angka kunci | `{narrative, category, is_copycat_of?, red_flags[], meme_quality 0–100, confidence}` | Token yang lolos filter murah (±200–500/hari) | Fitur skor + statistik "narrative mana yang lagi menang" |
| 2 | **Parser call Telegram** | teks pesan (regex CA dulu, LLM hanya kalau ambigu) | `{mints[], call_type: entry/update/exit, caller, confidence}` | Real-time-ish (detik) | Trigger profile `kol_call` + skor caller |
| 3 | **Thesis check (profil lambat)** | ringkasan numerik + konteks sosial | `{verdict: pass/veto, conviction 0–100, crowdedness, thesis}` | `swing_dip` / `trending_momentum` (bukan yang detik-an) | **Veto** saja, tidak bisa memicu beli |
| 4 | **Daily / weekly review** | statistik agregat (tanpa kunci/alamat wallet bot), hasil shadow, per profile/sumber/jam | laporan markdown + **proposal diff config** | Harian 00:10 UTC (Batch API boleh) | Halaman AI Insights; proposal wajib lolos replay + approve manual |
| 5 | **Incident explainer** | log sekitar circuit breaker/error | ringkasan penyebab + saran | Saat breaker trip | Notifikasi Telegram |
| 6 | **Ask-the-data** (opsional) | pertanyaan bahasa natural | SQL read-only (role `memebot_ro`) + jawaban | On-demand di dashboard | Eksplorasi data |

### Anti prompt-injection
- Nama/deskripsi token & pesan Telegram ditulis penyerang → dibungkus sebagai **data** (tag terpisah), dipotong panjangnya, karakter aneh dibuang, instruksi di dalamnya diabaikan.
- Output divalidasi schema (zod) — field di luar schema dibuang.
- LLM tidak punya tool apa pun di runtime (kecuali "Ask-the-data" yang SQL-nya dijalankan di role read-only + timeout).

## 3. Model & biaya (harga Anthropic per 2026-10)

| Model | ID | Input / Output per 1M token | Cocok untuk |
|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | $4 / $20 | Default: daily review, thesis check, analisa |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2 / $10 | Alternatif seimbang |
| Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 / $0.50 | Opsi murah untuk volume tinggi (tagger, parser) |

Estimasi narrative tagger (±600 token input + 150 output per token):

| Volume | Opus 5.5 | Haiku 5.5 |
|---|---|---|
| 300 token/hari (setelah filter murah) | ≈ $1.6/hari (~$49/bln) | ≈ $0.04/hari (~$1.2/bln) |
| 5.000 token/hari (semua trigger) | ≈ $27/hari (~$810/bln) | ≈ $0.7/hari (~$20/bln) |

Default di plan: **Opus 5.5** untuk semua tugas (rekomendasi standar), dengan opsi pindah tagger/parser ke **Haiku 5.5** kalau lo mau hemat — **keputusan lo** (di-set di `config/llm.yaml`). Pengiritan lain yang tidak mengorbankan kualitas:
- Tag hanya token yang lolos filter murah (hemat 10–25×).
- **Prompt caching** untuk system prompt yang tetap.
- **Batch API** (diskon 50%) untuk daily review & backfill (tidak real-time).
- Cache hasil per mint (narrative tidak berubah).
- Batas biaya harian (`llm.daily_budget_usd`) → kalau habis, worker berhenti dan fitur LLM jadi `null`.

## 4. Implementasi (Fase 4)
- `@anthropic-ai/sdk` (TypeScript), structured outputs (`output_config.format` dengan JSON schema), typed errors + retry, timeout per job.
- Antrian: tabel `llm_jobs` (Postgres `FOR UPDATE SKIP LOCKED`), prioritas (parser Telegram > tagger > review).
- Hasil ditulis ke `llm_annotations` → dibaca strategy engine sebagai fitur.
- Detail API (model ID, effort, caching) dicek ulang pakai docs resmi saat coding.

## 5. Yang sengaja TIDAK dilakukan
- ❌ LLM memutuskan beli/jual langsung (pelajaran Alpha Arena: >50% model rugi).
- ❌ LLM membaca/mengedit secret, wallet, atau config live tanpa approval.
- ❌ Framework agent trading penuh (ElizaOS dsb) di jalur produksi — terlalu banyak permukaan serangan untuk wallet berisi uang.
