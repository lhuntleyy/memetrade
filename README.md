# memebot

Bot trading memecoin Solana **multi-profile & multi-timeframe** (degen → momentum → swing) dengan **web monitoring real-time**, dibangun di atas TypeScript + Bun + PostgreSQL/TimescaleDB.

> Status: **perencanaan selesai, Fase 0 sebagian** (VPS sudah di-update + Bun terpasang). Belum ada kode trading. Lihat `PROGRESS.md`.
>
> ⚠️ Bukan financial advice. Memecoin sangat berisiko; mayoritas token berakhir rug/mati. Pakai uang yang siap hilang.

## Alur sistem

```
Trigger (PumpPortal · DexScreener · GMGN · Meteora · smart wallet · Telegram)
   → Enrichment (GMGN · Jupiter · on-chain · cross-check) + null gate
   → Security (authority · Token-2022 · simulasi jual · round-trip · blacklist)
   → Strategy profile (filter YAML · multi-timeframe · skor)
   → Risk manager (limit · daily stop · circuit breaker · kill switch)
   → Executor (paper realistis | live: Jupiter Swap V2 · Helius Sender · pump SDK)
   → Exit engine (SL · ladder · break-even · trailing bertingkat · momentum-fail · event · panic)
   → Journal + Shadow tracking → Dashboard · Telegram · Replay · LLM review
```

## Baca berurutan
1. [PLAN.md](PLAN.md) — tujuan, keputusan, fase, budget, risiko, keputusan yang menunggu lo
2. [PROGRESS.md](PROGRESS.md) — checklist & log
3. [docs/01-review-post.md](docs/01-review-post.md) — review post referensi + detail LLM-nya
4. [docs/02-research.md](docs/02-research.md) — riset provider & referensi (dengan link)
5. [docs/03-architecture.md](docs/03-architecture.md) — arsitektur, stack, skema DB
6. [docs/04-strategy.md](docs/04-strategy.md) — profile, MTF, filter, security, exit
7. [docs/05-risk-and-execution.md](docs/05-risk-and-execution.md) — risk, ekonomi trade, eksekusi, paper, go-live
8. [docs/06-dashboard.md](docs/06-dashboard.md) — web monitoring & Telegram
9. [docs/07-vps-setup.md](docs/07-vps-setup.md) — setup VPS
10. [docs/08-llm.md](docs/08-llm.md) — peran LLM
11. [docs/09-evaluation.md](docs/09-evaluation.md) — metrik, replay, kriteria go-live
12. [docs/DECISIONS.md](docs/DECISIONS.md) — log keputusan

## Stack
Bun 1.4 · TypeScript · PostgreSQL 17 + TimescaleDB · Drizzle · Elysia · React 19 + Tailwind v4 + shadcn/ui · lightweight-charts · ECharts · grammY · Anthropic SDK · systemd · Tailscale
