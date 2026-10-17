import { expect, test } from "bun:test";
import { ExitConfig } from "@memebot/shared";
import { metrics, simulate, sweepTpSl } from "../src/research/replay.ts";

const exit = ExitConfig.parse({
  hard_sl_pct: -15,
  take_profit_ladder: [{ at_pct: 30, sell_pct: 100 }],
  trailing: { tiers: [{ activate_at_pct: 20, distance_pct: 4 }] },
  max_hold_sec: 1800,
});
const o = { latencySec: 1, entryCostPct: 0, exitCostPct: 0 };
const path = (prices: number[], step = 5000) => prices.map((p, i) => ({ ts: i * step, price: p }));

test("entry di tick pertama setelah latency, TP +30% jual semua", () => {
  const t = simulate({ mint: "M", profile: "p", ts: 0 }, path([1, 1, 1.1, 1.31]), exit, o);
  expect(t?.entryTs).toBe(5000); // tick ts=0 < latency 1 dtk
  expect(t?.reason).toBe("take_profit");
  expect(t?.pnlPct).toBeCloseTo(31);
});

test("trailing dari +20 jarak 4 poin", () => {
  const t = simulate({ mint: "M", profile: "p", ts: -2000 }, path([1, 1.25, 1.2]), exit, o);
  expect(t?.reason).toBe("trailing");
  expect(t?.pnlPct).toBeCloseTo(20);
});

test("biaya entry/exit menurunkan PnL; data habis → tutup di tick terakhir", () => {
  const t = simulate({ mint: "M", profile: "p", ts: -2000 }, path([1, 1.05]), exit, {
    latencySec: 1,
    entryCostPct: 2,
    exitCostPct: 2,
  });
  expect(t?.reason).toBe("data_end");
  expect(t?.pnlPct).toBeCloseTo(((1.05 * 0.98) / 1.02 - 1) * 100);
  expect(simulate({ mint: "M", profile: "p", ts: 99_999 }, path([1, 2]), exit, o)).toBeNull();
});

test("metrik & sweep", () => {
  const m = metrics(
    [
      { mint: "a", profile: "p", entryTs: 0, exitTs: 1, pnlPct: 30, reason: "take_profit", peakPct: 30 },
      { mint: "b", profile: "p", entryTs: 0, exitTs: 2, pnlPct: -15, reason: "hard_sl", peakPct: 0 },
    ],
    3,
  );
  expect(m).toMatchObject({
    trades: 2,
    noData: 1,
    winRate: 50,
    profitFactor: 2,
    expectancyPct: 7.5,
    maxDrawdownPct: 15,
  });
  const data = {
    candidates: [{ mint: "M", profile: "p", ts: -2000 }],
    ticks: new Map([["M", path([1, 1.26, 1.21])]]),
  };
  const cells = sweepTpSl(data, exit, [25, 30], [10], o);
  expect(cells.find((c) => c.tp === 25)?.m.expectancyPct).toBeCloseTo(26); // TP 25 kena di 1.26
  expect(cells.find((c) => c.tp === 30)?.m.reasons).toEqual({ trailing: 1 }); // trailing (peak 26, turun) — tidak sampai TP 30
});
