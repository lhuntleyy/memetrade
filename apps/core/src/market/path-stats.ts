/**
 * Statistik jalur harga satu token setelah satu trigger (bahan Trigger Lab).
 * Return dalam persen relatif terhadap harga referensi = harga PASAR pertama yang teramati setelah
 * trigger (proxy harga yang realistis bisa kita dapat), bukan harga dev saat create.
 */

export const CHECKPOINTS_MIN = [1, 5, 15, 60] as const;
export const RUG_THRESHOLD_PCT = -80;
export const RUG_WINDOW_MIN = 60;

export interface PathRow {
  mint: string;
  source: string;
  t0: Date;
  trigger_price_sol: number | null;
  entry_price_ref: number | null;
  ref_delay_sec: number | null;
  n_ticks: number;
  ret_1m: number | null;
  ret_5m: number | null;
  ret_15m: number | null;
  ret_60m: number | null;
  max_ret: number | null;
  t_max_sec: number | null;
  min_ret: number | null;
  t_min_sec: number | null;
  rugged: boolean | null;
  completed_at: Date | null;
}

export class PathStats {
  ref: number | null = null;
  refAtMs: number | null = null;
  readonly checkpoints = new Map<number, number>();
  maxRet: number | null = null;
  tMaxSec: number | null = null;
  minRet: number | null = null;
  tMinSec: number | null = null;
  lastTs = 0;
  ticks = 0;
  completedAt: number | null = null;

  constructor(
    readonly mint: string,
    readonly source: string,
    readonly t0: number,
    /** harga yang dibawa trigger (mis. harga create dev) — hanya dicatat, BUKAN referensi return */
    readonly triggerPrice: number | null = null,
  ) {}

  /** Masukkan tick harga (ts ms). Tick lebih tua dari tick terakhir diabaikan. */
  update(ts: number, price: number): void {
    if (!(price > 0) || ts < this.lastTs || this.completedAt) return;
    this.lastTs = ts;
    this.ticks++;
    if (this.ref === null) {
      this.ref = price;
      this.refAtMs = ts;
    }
    const ret = (price / this.ref - 1) * 100;
    const tSec = Math.max(0, Math.round((ts - this.t0) / 1000));

    if (this.maxRet === null || ret > this.maxRet) {
      this.maxRet = ret;
      this.tMaxSec = tSec;
    }
    if (this.minRet === null || ret < this.minRet) {
      this.minRet = ret;
      this.tMinSec = tSec;
    }
    for (const m of CHECKPOINTS_MIN) {
      if (!this.checkpoints.has(m) && ts >= this.t0 + m * 60_000) this.checkpoints.set(m, ret);
    }
  }

  get rugged(): boolean | null {
    if (this.minRet === null) return null;
    return this.minRet <= RUG_THRESHOLD_PCT && (this.tMinSec ?? Infinity) <= RUG_WINDOW_MIN * 60;
  }

  isDue(now: number, trackMinutes: number): boolean {
    return now >= this.t0 + trackMinutes * 60_000;
  }

  complete(now: number) {
    this.completedAt ??= now;
  }

  toRow(): PathRow {
    const cp = (m: number) => round(this.checkpoints.get(m) ?? null);
    return {
      mint: this.mint,
      source: this.source,
      t0: new Date(this.t0),
      trigger_price_sol: this.triggerPrice,
      entry_price_ref: this.ref,
      ref_delay_sec: this.refAtMs === null ? null : Math.round((this.refAtMs - this.t0) / 1000),
      n_ticks: this.ticks,
      ret_1m: cp(1),
      ret_5m: cp(5),
      ret_15m: cp(15),
      ret_60m: cp(60),
      max_ret: round(this.maxRet),
      t_max_sec: this.tMaxSec,
      min_ret: round(this.minRet),
      t_min_sec: this.tMinSec,
      rugged: this.rugged,
      completed_at: this.completedAt ? new Date(this.completedAt) : null,
    };
  }
}

function round(v: number | null): number | null {
  return v === null ? null : Math.round(v * 100) / 100;
}
