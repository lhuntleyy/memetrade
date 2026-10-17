import { createDb, migrate } from "@memebot/db";
import { ConfigError, configSchemas, loadConfig } from "@memebot/shared";
import { despike } from "../../core/src/market/despike.ts";
import { PathStats } from "../../core/src/market/path-stats.ts";
import { loadRefilteredData, loadReplayData, runReplay, sweepTpSl } from "../../core/src/research/replay.ts";

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
