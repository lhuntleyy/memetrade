/**
 * Filter spike harga. DexScreener kadang memberi nilai sampah (harga 0 di pair bonding curve, atau lonjakan
 * ribuan kali lipat saat pair PumpSwap baru dibuat). Aturan: tick yang loncat > maxRatio× dari tick terakhir
 * yang diterima ditahan dulu, dan baru diterima kalau tick berikutnya mengonfirmasi (dekat dengan tick itu).
 */

export interface PricePoint {
  ts: number;
  price: number;
}

export class SpikeFilter {
  private last: PricePoint | null = null;
  /** tick yang menunggu konfirmasi setelah lonjakan besar */
  private pending: PricePoint[] = [];
  dropped = 0;

  /**
   * @param maxRatio lonjakan > maxRatio× perlu 1 tick konfirmasi
   * @param hugeRatio lonjakan > hugeRatio× perlu `hugeConfirm` tick konfirmasi (data DexScreener saat pair baru)
   */
  constructor(
    private readonly maxRatio = 8,
    private readonly hugeRatio = 50,
    private readonly hugeConfirm = 5,
  ) {}

  private jump(a: number, b: number) {
    return Math.max(a / b, b / a);
  }

  /** Masukkan satu tick; kembalikan tick yang diterima (bisa beberapa kalau pending terkonfirmasi). */
  push(p: PricePoint): PricePoint[] {
    if (!(p.price > 0) || !Number.isFinite(p.price)) {
      this.dropped++;
      return [];
    }
    if (!this.last) {
      this.last = p;
      return [p];
    }
    if (this.pending.length) {
      const ref = this.pending[0]!;
      if (this.jump(p.price, ref.price) <= 2) {
        this.pending.push(p);
        const need = this.jump(ref.price, this.last.price) > this.hugeRatio ? this.hugeConfirm : 2;
        if (this.pending.length >= need) {
          const out = this.pending;
          this.pending = [];
          this.last = out[out.length - 1]!;
          return out;
        }
        return [];
      }
      // level baru tidak bertahan → buang sebagai spike
      this.dropped += this.pending.length;
      this.pending = [];
    }
    if (this.jump(p.price, this.last.price) > this.maxRatio) {
      this.pending = [p];
      return [];
    }
    this.last = p;
    return [p];
  }
}

/** Harga minimum masuk akal untuk token pump.fun: curve mulai di mcap ±28 SOL (supply 1 miliar). */
export const PUMP_MIN_PRICE_SOL = 20 / 1_000_000_000;

export function plausiblePrice(mint: string, priceSol: number): boolean {
  if (!(priceSol > 0) || !Number.isFinite(priceSol)) return false;
  if (mint.endsWith("pump") && priceSol < PUMP_MIN_PRICE_SOL) return false;
  return true;
}

/** Versi batch untuk data historis. */
export function despike(points: PricePoint[], mint = ""): PricePoint[] {
  const f = new SpikeFilter();
  return points.filter((p) => plausiblePrice(mint, p.price)).flatMap((p) => f.push(p));
}
