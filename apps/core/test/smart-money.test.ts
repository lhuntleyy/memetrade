import { expect, test } from "bun:test";
import { ConfluenceWindow } from "../src/wallets/confluence.ts";
import { scoreWallet, type WalletAggregate } from "../src/wallets/scoring.ts";

const agg = (o: Partial<WalletAggregate> = {}): WalletAggregate => ({
  wallet: "W",
  tokens: 10,
  profitable: 7,
  totalProfitUsd: 10_000,
  withOutcome: 10,
  pumped: 4,
  rugged: 1,
  tags: [],
  isDev: false,
  ...o,
});

test("skor: komponen win/pump/bebas-rug/profit + tag", () => {
  const s = scoreWallet(agg(), 3);
  // win 0.7*35=24.5, pump 0.4*25=10, noRug 0.9*20=18, profit log10(1e4)/4=1 → 10
  expect(s.parts).toEqual({ win: 24.5, pump: 10, noRug: 18, profit: 10, tags: 0 });
  expect(s.score).toBe(62.5);
  expect(scoreWallet(agg({ tags: ["smart_degen"] }), 3).score).toBe(72.5);
  expect(scoreWallet(agg({ tags: ["bundler", "rat_trader"] }), 3).score).toBe(32.5);
});

test("dev/creator = 0, sampel kurang = null", () => {
  expect(scoreWallet(agg({ isDev: true }), 3).score).toBe(0);
  expect(scoreWallet(agg({ tokens: 2 }), 3).score).toBeNull();
});

test("konfluensi: 2 wallet berbeda dalam window → sinyal sekali (cooldown)", () => {
  const w = new ConfluenceWindow(2, 30 * 60_000, 60 * 60_000);
  const now = 10_000_000;
  expect(w.add("M", "A", now - 60_000, now)).toBeNull();
  expect(w.add("M", "A", now - 30_000, now)).toBeNull(); // wallet sama tidak dihitung dua kali
  expect(w.add("M", "B", now - 10_000, now)?.sort()).toEqual(["A", "B"]);
  expect(w.add("M", "C", now, now)).toBeNull(); // cooldown
  expect(w.count("M", now)).toBe(3);
});

test("konfluensi: pembelian di luar window tidak dihitung", () => {
  const w = new ConfluenceWindow(2, 30 * 60_000);
  const now = 10_000_000;
  expect(w.add("M", "A", now - 31 * 60_000, now)).toBeNull();
  expect(w.add("M", "B", now, now)).toBeNull();
  expect(w.count("M", now)).toBe(1);
});
