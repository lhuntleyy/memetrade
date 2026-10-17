import { expect, test } from "bun:test";
import {
  bucketize,
  type DatasetRow,
  groupStats,
  passes,
  searchRules,
  spearman,
  walkForwardRules,
} from "../src/research/features.ts";

// dataset sintetis: fitur "x" benar-benar menentukan hasil (x ≥ 50 → +20%, selain itu −10%), "noise" acak
const rows: DatasetRow[] = Array.from({ length: 400 }, (_, i) => {
  const x = (i * 37) % 100;
  const good = x >= 50;
  return {
    mint: `M${i}`,
    source: "s",
    ts: i * 1000,
    features: { x, noise: (i * 53) % 97, sparse: i % 2 ? null : 1 },
    pnl: good ? 20 : -10,
    peak: good ? 30 : 2,
    exitReason: good ? "take_profit" : "hard_sl",
  };
});

test("groupStats & passes", () => {
  const s = groupStats(rows);
  expect(s.n).toBe(400);
  expect(s.meanPnl).toBe(5);
  expect(passes(rows[0]!, [{ field: "sparse", op: "gte", value: 0 }])).toBe(true);
  expect(passes(rows[1]!, [{ field: "sparse", op: "gte", value: 0 }])).toBe(false); // null tidak lolos
});

test("bucket & spearman menangkap fitur prediktif", () => {
  const b = bucketize(rows, "x", 5);
  expect(b[0]!.stats.meanPnl).toBe(-10);
  expect(b[b.length - 1]!.stats.meanPnl).toBe(20);
  expect(spearman(rows, "x").rho!).toBeGreaterThan(0.8);
  expect(Math.abs(spearman(rows, "noise").rho!)).toBeLessThan(0.2);
});

test("searchRules & walk-forward memilih x ≥ ~50 dan unggul di out-of-sample", () => {
  const best = searchRules(rows, ["x", "noise"], 30)[0]!;
  expect(best.rules.some((r) => r.field === "x" && r.op === "gte")).toBe(true);
  expect(best.stats.meanPnl).toBe(20);
  const wf = walkForwardRules(rows, ["x", "noise"], 4, 30);
  expect(wf.oos.meanPnl).toBe(20);
  expect(wf.oosBaseline.meanPnl!).toBeLessThan(10);
});
