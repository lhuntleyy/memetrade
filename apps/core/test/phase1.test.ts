import { describe, expect, test } from "bun:test";
import { RateLimiter, TtlSet } from "@memebot/shared";
import { type DexPair, pickMainPair } from "../src/collectors/dexscreener.ts";
import { normalizePumpPortal } from "../src/collectors/pumpportal.ts";
import { PathStats } from "../src/market/path-stats.ts";

const MIN = 60_000;

describe("PathStats", () => {
  test("referensi = tick pasar pertama (harga trigger hanya dicatat), checkpoint & max/min", () => {
    const t0 = 1_000_000;
    const p = new PathStats("M", "pumpportal.new_token", t0, 0.01);
    p.update(t0 + 10_000, 1.0); // harga pasar pertama, delay 10 dtk
    p.update(t0 + 30_000, 1.5); // +50% di detik 30
    p.update(t0 + MIN, 1.2); // checkpoint 1m = +20%
    p.update(t0 + 5 * MIN, 0.5); // checkpoint 5m = -50%
    const r = p.toRow();
    expect(r.trigger_price_sol).toBe(0.01);
    expect(r.entry_price_ref).toBe(1);
    expect(r.ref_delay_sec).toBe(10);
    expect(r.n_ticks).toBe(4);
    expect(r.max_ret).toBe(50);
    expect(r.t_max_sec).toBe(30);
    expect(r.ret_1m).toBe(20);
    expect(r.ret_5m).toBe(-50);
    expect(r.min_ret).toBe(-50);
    expect(r.rugged).toBe(false);
  });

  test("tanpa harga awal → tick pertama jadi referensi", () => {
    const p = new PathStats("M", "dexscreener.boost", 0);
    p.update(1000, 2);
    p.update(2000, 3);
    expect(p.toRow().entry_price_ref).toBe(2);
    expect(p.toRow().max_ret).toBe(50);
  });

  test("rugged kalau turun ≥80% dalam 60 menit", () => {
    const p = new PathStats("M", "s", 0);
    p.update(0, 1);
    p.update(10 * MIN, 0.15);
    expect(p.rugged).toBe(true);
  });

  test("tick mundur & harga tidak valid diabaikan", () => {
    const p = new PathStats("M", "s", 0);
    p.update(1000, 1);
    p.update(5000, 2);
    p.update(4000, 10);
    p.update(6000, 0);
    expect(p.toRow().max_ret).toBe(100);
    expect(p.ticks).toBe(2);
  });

  test("selesai setelah track_minutes", () => {
    const p = new PathStats("M", "s", 0);
    expect(p.isDue(89 * MIN, 90)).toBe(false);
    expect(p.isDue(90 * MIN, 90)).toBe(true);
    p.complete(90 * MIN);
    p.update(91 * MIN, 5);
    expect(p.toRow().max_ret).toBeNull();
    expect(p.toRow().completed_at).toBeInstanceOf(Date);
  });
});

describe("normalizePumpPortal", () => {
  test("create → new_token dengan harga dari virtual reserve", () => {
    const n = normalizePumpPortal({
      txType: "create",
      signature: "sig",
      mint: "MintPump",
      traderPublicKey: "Dev",
      vTokensInBondingCurve: 1_000_000_000,
      vSolInBondingCurve: 30,
      marketCapSol: 30,
      name: "X",
      symbol: "X",
      pool: "pump",
    });
    expect(n?.kind).toBe("new_token");
    expect(n?.meta.priceSol).toBeCloseTo(3e-8);
    expect(n?.meta.creator).toBe("Dev");
  });

  test("migrate → migration", () => {
    expect(
      normalizePumpPortal({ txType: "migrate", signature: "s", mint: "M", pool: "pump-amm" })?.kind,
    ).toBe("migration");
  });

  test("pesan subscribe / sampah → null", () => {
    expect(normalizePumpPortal({ message: "Successfully subscribed" })).toBeNull();
    expect(normalizePumpPortal(null)).toBeNull();
    expect(normalizePumpPortal({ txType: "buy", signature: "s", mint: "M" })).toBeNull();
  });
});

describe("pickMainPair", () => {
  const pair = (o: Partial<DexPair>): DexPair => ({
    dexId: "x",
    pairAddress: "P",
    priceNative: "1",
    baseToken: { address: "M" },
    ...o,
  });

  test("prioritaskan quote SOL lalu likuiditas", () => {
    const sol = { address: "So11111111111111111111111111111111111111112" };
    const best = pickMainPair(
      [
        pair({ pairAddress: "usdc", quoteToken: { address: "USDC" }, liquidity: { usd: 1e6 } }),
        pair({ pairAddress: "sol-kecil", quoteToken: sol, liquidity: { usd: 1e3 } }),
        pair({ pairAddress: "sol-besar", quoteToken: sol, liquidity: { usd: 5e4 } }),
      ],
      "M",
    );
    expect(best?.pairAddress).toBe("sol-besar");
  });

  test("abaikan pair token lain / tanpa harga", () => {
    expect(
      pickMainPair([pair({ baseToken: { address: "LAIN" } }), pair({ priceNative: undefined })], "M"),
    ).toBeNull();
  });
});

describe("util", () => {
  test("TtlSet dedupe dengan kedaluwarsa", () => {
    const s = new TtlSet(1000);
    expect(s.add("a", 0)).toBe(true);
    expect(s.add("a", 500)).toBe(false);
    expect(s.add("a", 1500)).toBe(true);
  });

  test("RateLimiter membatasi burst", () => {
    const r = new RateLimiter(60, 3);
    expect([r.tryTake(), r.tryTake(), r.tryTake(), r.tryTake()]).toEqual([true, true, true, false]);
  });
});
