/**
 * Matematika AMM constant product (x·y = k) — dipakai untuk harga & "quote lokal" dari reserve pool,
 * supaya monitoring posisi tidak perlu memanggil Jupiter tiap tick (docs/02 §3, ADR-006).
 * Semua jumlah dalam unit terkecil (lamports / base units) sebagai bigint.
 */

const BPS = 10_000n;

/** Jumlah output untuk input `amountIn`, fee dipotong dari sisi input. */
export function cpAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: number): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (feeBps < 0 || feeBps >= 10_000) throw new RangeError("feeBps harus 0..9999");
  const inAfterFee = (amountIn * (BPS - BigInt(feeBps))) / BPS;
  return (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
}

/** Harga spot (output per input) tanpa fee, dalam float — untuk tampilan/indikator, bukan settlement. */
export function cpSpotPrice(reserveIn: bigint, reserveOut: bigint): number {
  if (reserveIn <= 0n) return 0;
  return Number(reserveOut) / Number(reserveIn);
}

/** Price impact (%) dari order `amountIn` relatif ke harga spot, termasuk fee. */
export function cpPriceImpactPct(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: number,
): number {
  const out = cpAmountOut(amountIn, reserveIn, reserveOut, feeBps);
  if (out === 0n) return 100;
  const spotOut = Number(amountIn) * cpSpotPrice(reserveIn, reserveOut);
  return (1 - Number(out) / spotOut) * 100;
}
