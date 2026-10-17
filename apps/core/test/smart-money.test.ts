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

test("feed GMGN: 2 wallet smart_degen beli token sama → trigger smart_confluence; tx dobel & kecil diabaikan", async () => {
  const { EventBus, SourcesConfig } = await import("@memebot/shared");
  const { ConfluenceDetector } = await import("../src/wallets/confluence.ts");
  const fakeDb = ((..._a: unknown[]) => Promise.resolve([])) as never; // semua query → []
  const bus = new EventBus();
  const triggers: unknown[] = [];
  bus.on("TokenTriggered", (e) => void triggers.push(e));
  const cfg = SourcesConfig.shape.wallet_tracker.parse(undefined);
  const det = new ConfluenceDetector(
    () => cfg,
    { pausedForSec: 0 } as never,
    fakeDb,
    bus,
    console as never,
    () => "PEP",
  );
  const now = Math.floor(Date.now() / 1000);
  const trade = (tx: string, maker: string, usd: number) => ({
    transaction_hash: tx,
    maker,
    side: "buy",
    amount_usd: usd,
    timestamp: now,
    base_address: "MintPepper",
    maker_info: { tags: ["smart_degen"] },
  });
  await det.ingestFeed(
    "smartmoney",
    [trade("t1", "A", 248), trade("t1", "A", 248), trade("t2", "B", 50)],
    100,
  );
  expect(triggers.length).toBe(0); // B di bawah min_usd, t1 dobel
  await det.ingestFeed("smartmoney", [trade("t3", "C", 500)], 100);
  det.stop();
  expect(triggers.length).toBe(1);
  const e = triggers[0] as {
    source: string;
    kind: string;
    payload: { features: { smart_confluence_count: number } };
  };
  expect(e.source).toBe("wallet");
  expect(e.kind).toBe("smart_confluence");
  expect(e.payload.features.smart_confluence_count).toBe(2);
});
