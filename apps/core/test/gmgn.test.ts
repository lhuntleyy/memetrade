import { expect, test } from "bun:test";
import { gmgnFeatures, gmgnSecurityReasons } from "../src/enrich/gmgn.ts";

// bentuk asli respons /v1/token/info & /v1/token/security (token pump.fun pasca-migrasi, 2026-10-17)
const data = {
  info: {
    holder_count: 263,
    liquidity: 16006.2,
    dev: { dexscr_update_link: 1, cto_flag: 0 },
    stat: {
      top_10_holder_rate: 0.2827,
      top_bundler_trader_percentage: 0.4519,
      top_rat_trader_percentage: 0.0046,
      bot_degen_rate: 0.4901,
      fresh_wallet_rate: 0.0855,
      creator_hold_rate: 0,
      dev_team_hold_rate: 0,
      creator_created_count: 14,
      top70_sniper_hold_rate: 0,
    },
    wallet_tags_stat: { smart_wallets: 13, renowned_wallets: 0 },
  },
  security: { is_honeypot: null, honeypot: 0, can_not_sell: 0, buy_tax: 0, sell_tax: 0 },
};

test("rasio GMGN dikonversi ke persen, null tetap null", () => {
  const f = gmgnFeatures(data);
  expect(f.top10_pct).toBe(28.27);
  expect(f.bundler_pct).toBe(45.19);
  expect(f.sniper_pct).toBe(0);
  expect(f.dev_hold_pct).toBe(0);
  expect(f.dev_created_count).toBe(14);
  expect(f.smart_wallets).toBe(13);
  expect(f.dex_paid).toBe(true);
  expect(gmgnFeatures({ info: null, security: null })).toEqual({});
});

test("honeypot / tidak bisa jual / pajak tinggi → alasan security", () => {
  expect(gmgnSecurityReasons(data)).toEqual([]);
  expect(
    gmgnSecurityReasons({
      info: null,
      security: { is_honeypot: true, can_not_sell: 1, sell_tax: 0.25, buy_tax: "0.02" },
    }),
  ).toEqual(["gmgn_honeypot", "gmgn_cannot_sell", "gmgn_sell_tax_25pct"]);
});
