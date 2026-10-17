import { expect, test } from "bun:test";
import type { GmgnHolder } from "../src/enrich/gmgn.ts";
import { classifyHolders, isNonTraderAccount } from "../src/wallets/tracker.ts";

const h = (address: string, pct: number, buy: number, extra: Partial<GmgnHolder> = {}): GmgnHolder => ({
  address,
  addr_type: 0,
  exchange: "",
  amount_percentage: pct,
  buy_volume_cur: buy,
  usd_value: buy * 1.2,
  tags: [],
  maker_token_tags: [],
  ...extra,
});

test("akun pool/exchange tidak dihitung sebagai trader", () => {
  expect(isNonTraderAccount(h("P", 0.5, 0, { exchange: "pump_amm" }))).toBe(true);
  expect(isNonTraderAccount(h("P", 0.5, 0, { addr_type: 2 }))).toBe(true);
  expect(isNonTraderAccount(h("W", 0.05, 100))).toBe(false);
});

test("top holder tanpa pool + tier pembeli besar 500/1000", () => {
  const obs = classifyHolders(
    "M",
    [
      h("POOL", 0.6, 0, { exchange: "pump_amm" }),
      h("A", 0.05, 1500, { tags: ["smart_degen"] }),
      h("B", 0.04, 700),
      h("C", 0.03, 200),
      h("D", 0.02, 999.99),
    ],
    { top_n: 2, big_buyer_usd: [1000, 500] },
  );
  const top = obs.filter((o) => o.kind === "top_holder").map((o) => [o.wallet, o.rank]);
  const big = obs.filter((o) => o.kind === "big_buyer").map((o) => [o.wallet, o.buy_tier_usd]);
  expect(top).toEqual([
    ["A", 1],
    ["B", 2],
  ]);
  expect(big).toEqual([
    ["A", 1000],
    ["B", 500],
    ["D", 500],
  ]);
  expect(obs.find((o) => o.wallet === "A")?.amount_pct).toBe(5);
  expect(obs.find((o) => o.wallet === "A")?.tags).toEqual(["smart_degen"]);
});
