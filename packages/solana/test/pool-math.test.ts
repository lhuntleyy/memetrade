import { describe, expect, test } from "bun:test";
import { cpAmountOut, cpPriceImpactPct, cpSpotPrice } from "../src/index.ts";

const SOL = 1_000_000_000n;

describe("constant product", () => {
  test("tanpa fee: x*y=k terjaga (dibulatkan ke bawah)", () => {
    const x = 100n * SOL;
    const y = 1_000_000_000n * 1_000_000n;
    const out = cpAmountOut(1n * SOL, x, y, 0);
    expect((x + SOL) * (y - out) >= x * y).toBe(true);
  });

  test("fee mengurangi output", () => {
    const a = cpAmountOut(SOL, 100n * SOL, 10_000n * SOL, 0);
    const b = cpAmountOut(SOL, 100n * SOL, 10_000n * SOL, 25);
    expect(b < a).toBe(true);
  });

  test("order 1% dari pool → impact ≈ 1% (+fee)", () => {
    const impact = cpPriceImpactPct(SOL, 100n * SOL, 10_000n * SOL, 25);
    expect(impact).toBeGreaterThan(1.1);
    expect(impact).toBeLessThan(1.3);
  });

  test("input nol / reserve kosong → 0", () => {
    expect(cpAmountOut(0n, SOL, SOL, 25)).toBe(0n);
    expect(cpAmountOut(SOL, 0n, SOL, 25)).toBe(0n);
    expect(cpSpotPrice(0n, SOL)).toBe(0);
  });

  test("fee tidak valid ditolak", () => {
    expect(() => cpAmountOut(SOL, SOL, SOL, 10_000)).toThrow(RangeError);
  });
});
