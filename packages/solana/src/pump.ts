/**
 * Bonding curve pump.fun: harga = virtualSol / virtualToken (constant product atas reserve virtual).
 * PumpPortal mengirim reserve dalam unit UI (SOL dan token, desimal token = 6), jadi rumus langsung.
 */

export const PUMP_TOKEN_DECIMALS = 6;
export const PUMP_TOTAL_SUPPLY = 1_000_000_000; // token (UI units)

/** Harga SOL per 1 token (UI units). */
export function pumpCurvePriceSol(vSolUi: number, vTokensUi: number): number {
  if (!(vSolUi > 0) || !(vTokensUi > 0)) return 0;
  return vSolUi / vTokensUi;
}

/** Market cap dalam SOL (supply tetap 1 miliar). */
export function pumpMcapSol(priceSol: number, supply = PUMP_TOTAL_SUPPLY): number {
  return priceSol * supply;
}
