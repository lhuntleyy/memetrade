import { expect, test } from "bun:test";
import { despike } from "../src/market/despike.ts";

const pts = (ps: number[]) => ps.map((price, i) => ({ ts: i, price }));

test("harga 0 & spike sesaat dibuang, gerakan yang bertahan diterima", () => {
  // 0 dibuang; 1000× sesaat dibuang; naik 10× yang bertahan 2 tick diterima
  const out = despike(pts([1, 0, 1.1, 1000, 1.2, 12, 12.5, 13]));
  expect(out.map((p) => p.price)).toEqual([1, 1.1, 1.2, 12, 12.5, 13]);
});

test("gerakan normal tidak disentuh", () => {
  expect(despike(pts([1, 2, 3, 1.5, 0.5])).length).toBe(5);
});

test("lonjakan raksasa (>50×) butuh 5 tick konfirmasi; harga pump di bawah curve dibuang", () => {
  // pola asli DexScreener: harga palsu 7658× bertahan 3 tick lalu kembali normal
  const bogus = despike(pts([1e-7, 1.1e-7, 7.6e-4, 7.6e-4, 7.6e-4, 1.2e-7, 1.3e-7]));
  expect(bogus.map((p) => p.price)).toEqual([1e-7, 1.1e-7, 1.2e-7, 1.3e-7]);
  // pump.fun: 2.5e-9 SOL = mcap 2.5 SOL (mustahil) → dibuang
  expect(despike(pts([2.5e-9, 3e-8, 3.1e-8]), "XYZpump").map((p) => p.price)).toEqual([3e-8, 3.1e-8]);
});
