import { expect, test } from "bun:test";
import { ExitConfig } from "@memebot/shared";
import {
  calibrationOptions,
  fitSourceHaircuts,
  sourceGroup,
  type TradeComparison,
} from "../src/research/calibration.ts";
import { simulate } from "../src/research/replay.ts";

const exit = ExitConfig.parse({
  hard_sl_pct: -15,
  take_profit_ladder: [{ at_pct: 30, sell_pct: 100 }],
  max_hold_sec: 1800,
});
const path = (prices: number[], step = 5000) => prices.map((p, i) => ({ ts: i * step, price: p }));

test("capProfitAtTp: lompatan tick di atas TP dibatasi di level TP", () => {
  const base = { latencySec: 1, entryCostPct: 0, exitCostPct: 0 };
  const jump = path([1, 1, 1.8]);
  expect(simulate({ mint: "M", profile: "p", ts: 0 }, jump, exit, base)?.pnlPct).toBeCloseTo(80);
  const capped = simulate({ mint: "M", profile: "p", ts: 0 }, jump, exit, { ...base, capProfitAtTp: true });
  expect(capped?.pnlPct).toBeCloseTo(30);
  const cut = simulate({ mint: "M", profile: "p", ts: 0 }, jump, exit, {
    ...base,
    capProfitAtTp: true,
    flatHaircutPct: 5,
  });
  expect(cut?.pnlPct).toBeCloseTo(25);
});

test("sourceGroup memetakan trigger & nama profile", () => {
  expect(sourceGroup("pumpportal.migration")).toBe("migration");
  expect(sourceGroup("explore_migration")).toBe("migration");
  expect(sourceGroup("dexscreener.boost")).toBe("dexscreener");
  expect(sourceGroup("trending_momentum")).toBe("dexscreener");
  expect(sourceGroup("wallet.smart_confluence")).toBe("wallet");
  expect(sourceGroup("smart_money")).toBe("wallet");
  expect(sourceGroup("pumpportal.new_token")).toBe("new_token");
});

const cmp = (profile: string, paper: number, replay: number): TradeComparison => ({
  id: 1,
  mint: "M",
  profile,
  entryRequestedAt: 0,
  paperPnlPct: paper,
  paperReason: "x",
  liquidityUsd: null,
  entrySlipPct: null,
  replayPnlPct: replay,
  replayReason: "x",
});

test("potongan per sumber: hanya replay yang terlalu optimis, disusutkan untuk sampel kecil", () => {
  const c = [
    ...Array.from({ length: 20 }, () => cmp("explore_migration", -10, 0)),
    ...Array.from({ length: 20 }, () => cmp("smart_money", 0, -3)),
  ];
  const h = fitSourceHaircuts(c, 20);
  expect(h.migration).toBeCloseTo(5); // 10 × 20/(20+20)
  expect(h.wallet).toBe(0); // replay sudah pesimis → tidak dipercantik
});

test("calibrationOptions: tanpa kalibrasi → kosong; metode source pilih potongan per kelompok", () => {
  expect(calibrationOptions(null, "smart_money")).toEqual({});
  const cal = {
    method: "source" as const,
    sourceHaircutPct: { migration: 7.3, wallet: 0 },
    exitGapPct: {},
    capProfitAtTp: true,
    entrySlipPct: null,
  };
  expect(calibrationOptions(cal, "pumpportal.migration")).toMatchObject({
    capProfitAtTp: true,
    flatHaircutPct: 7.3,
  });
  expect(calibrationOptions(cal, "explore_new_token").flatHaircutPct).toBe(0);
});
