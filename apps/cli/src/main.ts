import { createDb, migrate } from "@memebot/db";
import { ConfigError, configSchemas, loadConfig } from "@memebot/shared";
import { despike } from "../../core/src/market/despike.ts";
import { PathStats } from "../../core/src/market/path-stats.ts";
import {
  bucketize,
  type DatasetRow,
  delayRows,
  groupStats,
  loadDataset,
  loadPathCandidates,
  numericFeatures,
  ruleLabel,
  searchRules,
  spearman,
  walkForwardDelay,
  walkForwardRules,
} from "../../core/src/research/features.ts";
import {
  loadRefilteredData,
  loadReplayData,
  runReplay,
  sweepTpSl,
  walkForward,
} from "../../core/src/research/replay.ts";

const commands: Record<string, { help: string; run: (args: string[]) => Promise<number> }> = {
  migrate: {
    help: "jalankan migrasi SQL yang belum dijalankan",
    async run() {
      const db = createDb(process.env.DATABASE_URL, { max: 1 });
      try {
        const ran = await migrate(db);
        console.log(ran.length ? `selesai: ${ran.join(", ")}` : "skema sudah terbaru");
        return 0;
      } finally {
        await db.close();
      }
    },
  },
  replay: {
    help: "backtest exit di data rekaman: replay [profile|all] [jam=24] [passed|evaluated]",
    async run(args) {
      const [profile = "all", hoursArg = "24", universeArg = "passed"] = args;
      const strategy = (await loadConfig("strategy")).data;
      const p = profile === "all" ? Object.values(strategy.profiles)[0] : strategy.profiles[profile];
      if (!p) {
        console.error(`profile '${profile}' tidak ada`);
        return 1;
      }
      const exit = strategy.exits[p.exits.ref.replace(/^exits\./, "")]!;
      const db = createDb(process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL, { max: 2 });
      try {
        const data = await loadReplayData(db, {
          profile,
          hours: Number(hoursArg),
          universe: universeArg === "evaluated" ? "evaluated" : "passed",
          horizonSec: exit.max_hold_sec + 60,
        });
        const opts = { latencySec: 1, entryCostPct: 1.5, exitCostPct: 1.5 };
        const r = runReplay(data, exit, opts);
        console.log(`kandidat ${data.candidates.length}, mint dengan tick ${data.ticks.size}`);
        console.log("exit config sekarang:", r.metrics);
        const cells = sweepTpSl(data, exit, [15, 20, 25, 30, 40, 50], [10, 15, 20, 30], opts);
        console.log("\nsweep TP(jual 100%) × SL — expectancy %/trade (win rate):");
        console.log(`TP\\SL ${[10, 15, 20, 30].map((s) => `SL${s}`.padStart(14)).join("")}`);
        for (const tp of [15, 20, 25, 30, 40, 50]) {
          const row = [10, 15, 20, 30].map((sl) => {
            const m = cells.find((c) => c.tp === tp && c.sl === sl)!.m;
            return `${m.expectancyPct ?? "-"} (${m.winRate ?? "-"}%)`.padStart(14);
          });
          console.log(`TP${String(tp).padEnd(4)}${row.join("")}`);
        }
        const wf = walkForward(data, exit, [15, 20, 25, 30, 40, 50], [10, 15, 20, 30], opts, 4, 10);
        console.log("\nwalk-forward (4 fold, anchored):");
        for (const f of wf.folds)
          console.log(
            `  fold ${f.fold}: terbaik latih ${f.best ? `TP${f.best.tp}/SL${f.best.sl}` : "-"} → uji ${f.test?.expectancyPct ?? "-"}% (${f.test?.trades ?? 0} trade) | config sekarang ${f.testCurrent.expectancyPct ?? "-"}%`,
          );
        console.log(
          `  OOS optimasi: ${wf.oos.expectancyPct}%/trade (${wf.oos.trades}) | OOS config sekarang: ${wf.oosCurrent.expectancyPct}%/trade | kombinasi berbeda: ${wf.distinctBest}`,
        );
        return 0;
      } finally {
        await db.close();
      }
    },
  },
  refilter: {
    help: "uji filter profile (config sekarang) pada token yang pernah dievaluasi: refilter <profile> [jam=24]",
    async run(args) {
      const [profile, hoursArg = "24"] = args;
      const strategy = (await loadConfig("strategy")).data;
      const p = profile ? strategy.profiles[profile] : undefined;
      if (!p) {
        console.error(`profile '${profile}' tidak ada`);
        return 1;
      }
      const exit = strategy.exits[p.exits.ref.replace(/^exits\./, "")]!;
      const db = createDb(process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL, { max: 2 });
      try {
        const d = await loadRefilteredData(db, {
          triggerSources: p.triggers,
          hours: Number(hoursArg),
          horizonSec: exit.max_hold_sec + 60,
          filters: p.filters,
          defaults: strategy.defaults,
        });
        const m = runReplay(d, exit, { latencySec: 1, entryCostPct: 2, exitCostPct: 2 }).metrics;
        console.log(`dievaluasi ${d.evaluated}, lolos filter ${d.candidates.length}, trade ${m.trades}`);
        console.log(m);
        const top = Object.entries(d.rejected)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8);
        console.log("alasan tolak teratas:", top.map(([k, v]) => `${k}=${v}`).join(", "));
        console.log(
          "catatan: fitur diambil saat evaluasi lama (waktu tunggu lama), bukan waktu tunggu config sekarang.",
        );
        return 0;
      } finally {
        await db.close();
      }
    },
  },
  analyze: {
    help: "analisa fitur → PnL replay per sumber + pencarian rule + walk-forward: analyze [jam=24] [file-laporan]",
    async run(args) {
      const [hoursArg = "24", outPath] = args;
      const hours = Number(hoursArg);
      const strategy = (await loadConfig("strategy")).data;
      const exit = strategy.exits.quick_flip ?? Object.values(strategy.exits)[0]!;
      const db = createDb(process.env.DATABASE_URL_RO ?? process.env.DATABASE_URL, { max: 2 });
      try {
        const replay = { latencySec: 1, entryCostPct: 2, exitCostPct: 2 };
        const rows = await loadDataset(db, { hours, exit, replay, horizonSec: exit.max_hold_sec + 60 });
        const groups: [string, (r: DatasetRow) => boolean][] = [
          ["Token baru pump.fun (pumpportal.new_token)", (r) => r.source === "pumpportal.new_token"],
          ["Migrasi pump.fun (pumpportal.migration)", (r) => r.source === "pumpportal.migration"],
          ["DexScreener profile/boost", (r) => r.source.startsWith("dexscreener.")],
          ["Konfluensi smart money", (r) => r.source.startsWith("wallet.")],
        ];
        const md: string[] = [];
        const p = (x: string) => md.push(x);
        const st = (g: ReturnType<typeof groupStats>) =>
          `${g.n} trade · mean ${g.meanPnl ?? "–"}% · median ${g.medianPnl ?? "–"}% · win ${g.winRate ?? "–"}% · puncak≥25% ${g.hit25 ?? "–"}% · kena SL ${g.slRate ?? "–"}%`;
        p(
          `# Analisa fitur → hasil trade (${new Date().toISOString().slice(0, 16)} UTC, ${hours} jam terakhir)`,
        );
        p("");
        p(
          `Target = PnL replay exit \`quick_flip\` (TP +30%, trailing dari +20% jarak 4, SL −15%, momentum-fail 3 mnt, max hold 30 mnt) kalau masuk ±1 dtk setelah token dievaluasi, biaya entry 2% + exit 2%. Token yang gagal security dikeluarkan.`,
        );
        p("");
        p(
          `Total baris: ${rows.length} · dengan data harga setelah entry: ${rows.filter((r) => r.pnl !== null).length}`,
        );
        for (const [name, pred] of groups) {
          const g = rows.filter(pred);
          const traded = g.filter((r) => r.pnl !== null);
          p("");
          p(`## ${name}`);
          p("");
          p(`**Baseline (semua):** ${st(groupStats(g))}`);
          if (traded.length < 60) {
            p("");
            p(`_Sampel terlalu kecil (${traded.length} trade) untuk analisa fitur yang bisa dipercaya._`);
            continue;
          }
          const feats = numericFeatures(traded, 0.3);
          const corr = feats
            .map((f) => ({ f, ...spearman(traded, f) }))
            .filter((c) => c.rho !== null)
            .sort((a, b) => Math.abs(b.rho!) - Math.abs(a.rho!));
          p("");
          p("### Korelasi peringkat (Spearman) fitur ↔ PnL");
          p("");
          p("| Fitur | rho | n |");
          p("|---|---|---|");
          for (const c of corr.slice(0, 12)) p(`| ${c.f} | ${c.rho} | ${c.n} |`);
          p("");
          p("### Bucket kuantil fitur paling berpengaruh");
          for (const c of corr.slice(0, 6)) {
            p("");
            p(`**${c.f}** (rho ${c.rho})`);
            p("");
            p("| Rentang | n | mean PnL | median | win | puncak≥25% | kena SL |");
            p("|---|---|---|---|---|---|---|");
            for (const b of bucketize(traded, c.f, 5))
              p(
                `| ${b.label} | ${b.stats.n} | ${b.stats.meanPnl}% | ${b.stats.medianPnl}% | ${b.stats.winRate}% | ${b.stats.hit25}% | ${b.stats.slRate}% |`,
              );
          }
          const minN = Math.max(20, Math.floor(traded.length * 0.08));
          const best = searchRules(traded, feats, minN).slice(0, 5);
          p("");
          p(`### Rule terbaik in-sample (min ${minN} trade) — JANGAN dipercaya sebelum lihat walk-forward`);
          p("");
          p("| Rule | hasil |");
          p("|---|---|");
          for (const b of best) p(`| ${ruleLabel(b.rules)} | ${st(b.stats)} |`);
          const wf = walkForwardRules(traded, feats, 4, Math.max(15, Math.floor(minN / 2)));
          p("");
          p("### Walk-forward pemilihan rule (4 fold, anchored)");
          p("");
          p("| Fold | rule terpilih (dari data lampau) | latih mean | uji: rule | uji: tanpa filter |");
          p("|---|---|---|---|---|");
          for (const f of wf.folds)
            p(
              `| ${f.fold} | ${f.chosen} | ${f.trainMean ?? "–"}% (${f.trainN}) | ${f.test.meanPnl ?? "–"}% (${f.test.n}) | ${f.baseline.meanPnl ?? "–"}% (${f.baseline.n}) |`,
            );
          p("");
          p(`**Out-of-sample gabungan:** dengan rule → ${st(wf.oos)}`);
          p("");
          p(`**Out-of-sample tanpa filter:** ${st(wf.oosBaseline)}`);
          p("");
          p(`Rule paling sering terpilih: \`${wf.mostChosen}\``);
        }
        // ---- uji waktu entry: semua trigger dengan jalur harga (bukan hanya yang dievaluasi) ----
        const delays = [0.5, 2, 5, 10, 15, 20];
        const paths = await loadPathCandidates(db, hours, 60);
        p("");
        p("## Uji waktu entry (semua trigger yang punya jalur harga, tanpa filter)");
        p("");
        p(
          "Masuk N menit setelah trigger, exit quick_flip, biaya 2%+2%. Sampel jauh lebih besar daripada token yang dievaluasi pipeline.",
        );
        const srcGroups: [string, (s: string) => boolean][] = [
          ["Token baru", (s) => s === "pumpportal.new_token"],
          ["Migrasi", (s) => s === "pumpportal.migration"],
          ["DexScreener", (s) => s.startsWith("dexscreener.")],
        ];
        for (const [name, pred] of srcGroups) {
          const sub = { cands: paths.cands.filter((c) => pred(c.source)), ticks: paths.ticks };
          p("");
          p(`### ${name} (${sub.cands.length} trigger)`);
          p("");
          p("| Masuk setelah | trade | mean PnL | median | win | puncak≥25% | kena SL |");
          p("|---|---|---|---|---|---|---|");
          for (const d of delays) {
            const g = groupStats(delayRows(sub, d, exit, replay));
            p(
              `| ${d} menit | ${g.n} | ${g.meanPnl ?? "–"}% | ${g.medianPnl ?? "–"}% | ${g.winRate ?? "–"}% | ${g.hit25 ?? "–"}% | ${g.slRate ?? "–"}% |`,
            );
          }
          if (sub.cands.length >= 60) {
            const wf = walkForwardDelay(sub, delays, exit, replay, 4, 15);
            p("");
            p(
              `Walk-forward pilihan delay: ${wf.folds.map((f) => `fold ${f.fold}: ${f.chosen} mnt → ${f.test.meanPnl ?? "–"}% (n ${f.test.n})`).join(" · ")}`,
            );
            p("");
            p(`**OOS delay terpilih:** ${st(wf.oos)} · **OOS masuk 0,5 menit:** ${st(wf.oosDelay0)}`);
          }
        }
        // ---- sensitivitas biaya: apakah ada edge yang cuma termakan biaya? ----
        p("");
        p("## Sensitivitas biaya (masuk 0,5 menit setelah trigger, tanpa filter)");
        p("");
        p(
          "Biaya round-trip = entry + exit (fee pool/platform + price impact + jaringan). Token likuid pasca-migrasi realistis ±1–2%, token bonding curve baru ±3–5%.",
        );
        p("");
        p("| Sumber | biaya 1% | biaya 2% | biaya 3% | biaya 4% |");
        p("|---|---|---|---|---|");
        for (const [name, pred] of srcGroups) {
          const sub = { cands: paths.cands.filter((c) => pred(c.source)), ticks: paths.ticks };
          const cells = [1, 2, 3, 4].map((c) => {
            const g = groupStats(
              delayRows(sub, 0.5, exit, { latencySec: 1, entryCostPct: c / 2, exitCostPct: c / 2 }),
            );
            return `${g.meanPnl ?? "–"}% (med ${g.medianPnl ?? "–"}%)`;
          });
          p(`| ${name} | ${cells.join(" | ")} |`);
        }
        const text = md.join("\n");
        if (outPath) {
          await Bun.write(outPath, `${text}\n`);
          console.log(`laporan ditulis ke ${outPath}`);
        } else console.log(text);
        return 0;
      } finally {
        await db.close();
      }
    },
  },
  "paths:recompute": {
    help: "hitung ulang tracked_paths yang sudah selesai dari tick yang dibersihkan (filter spike)",
    async run() {
      const db = createDb(process.env.DATABASE_URL, { max: 2 });
      try {
        const sources = await loadConfig("sources");
        const trackMs = sources.data.tracker.track_minutes * 60_000;
        const rows =
          await db`SELECT mint, source, t0, trigger_price_sol, completed_at FROM tracked_paths WHERE completed_at IS NOT NULL`;
        let changed = 0;
        for (const r of rows as {
          mint: string;
          source: string;
          t0: Date;
          trigger_price_sol: number | null;
          completed_at: Date;
        }[]) {
          const t0 = new Date(r.t0).getTime();
          const ticks = await db`SELECT ts, price_sol FROM ticks WHERE mint = ${r.mint}
                                 AND ts BETWEEN ${new Date(t0)} AND ${new Date(t0 + trackMs)} ORDER BY ts`;
          const clean = despike(
            (ticks as { ts: Date; price_sol: number }[]).map((t) => ({
              ts: new Date(t.ts).getTime(),
              price: Number(t.price_sol),
            })),
            r.mint,
          );
          const p = new PathStats(r.mint, r.source, t0, r.trigger_price_sol);
          for (const t of clean) p.update(t.ts, t.price);
          p.complete(new Date(r.completed_at).getTime());
          const x = p.toRow();
          await db`UPDATE tracked_paths SET entry_price_ref = ${x.entry_price_ref}, ref_delay_sec = ${x.ref_delay_sec},
                     n_ticks = ${x.n_ticks}, ret_1m = ${x.ret_1m}, ret_5m = ${x.ret_5m}, ret_15m = ${x.ret_15m},
                     ret_60m = ${x.ret_60m}, max_ret = ${x.max_ret}, t_max_sec = ${x.t_max_sec}, min_ret = ${x.min_ret},
                     t_min_sec = ${x.t_min_sec}, rugged = ${x.rugged}
                   WHERE mint = ${r.mint} AND source = ${r.source} AND t0 = ${r.t0}`;
          changed++;
        }
        console.log(`dihitung ulang: ${changed} path`);
        return 0;
      } finally {
        await db.close();
      }
    },
  },
  "config:check": {
    help: "validasi semua file config/*.yaml",
    async run() {
      let failed = 0;
      for (const kind of Object.keys(configSchemas) as (keyof typeof configSchemas)[]) {
        try {
          const c = await loadConfig(kind);
          console.log(`✓ ${kind.padEnd(9)} ${c.hash.slice(0, 12)}  ${c.path}`);
        } catch (e) {
          failed++;
          console.error(e instanceof ConfigError ? `✗ ${e.message}` : e);
        }
      }
      return failed ? 1 : 0;
    },
  },
};

const [name, ...args] = process.argv.slice(2);
const cmd = name ? commands[name] : undefined;
if (!cmd) {
  console.log("pemakaian: bun run apps/cli/src/main.ts <perintah>\n");
  for (const [n, c] of Object.entries(commands)) console.log(`  ${n.padEnd(14)} ${c.help}`);
  process.exit(name ? 1 : 0);
}
process.exit(await cmd.run(args));
