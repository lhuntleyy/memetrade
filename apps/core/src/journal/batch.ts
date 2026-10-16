import type { Logger } from "@memebot/shared";

/**
 * Buffer + flush berkala ke DB. Kalau flush gagal, baris dikembalikan ke antrian (dibatasi maxBuffer
 * supaya RAM aman — kelebihan dibuang dan dihitung di `dropped`).
 */
export class BatchWriter<T> {
  private buf: T[] = [];
  private timer: Timer;
  private flushing = false;
  dropped = 0;
  written = 0;

  constructor(
    private readonly name: string,
    private readonly write: (rows: T[]) => Promise<void>,
    private readonly log: Logger,
    flushMs = 1000,
    private readonly maxBatch = 1000,
    private readonly maxBuffer = 50_000,
  ) {
    this.timer = setInterval(() => void this.flush(), flushMs);
  }

  push(row: T) {
    if (this.buf.length >= this.maxBuffer) {
      this.dropped++;
      return;
    }
    this.buf.push(row);
  }

  get pending() {
    return this.buf.length;
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buf.length === 0) return;
    this.flushing = true;
    try {
      while (this.buf.length) {
        const batch = this.buf.splice(0, this.maxBatch);
        try {
          await this.write(batch);
          this.written += batch.length;
        } catch (err) {
          this.buf.unshift(...batch.slice(0, this.maxBuffer - this.buf.length));
          this.log.error(
            { writer: this.name, rows: batch.length, err: String(err) },
            "flush gagal, coba lagi nanti",
          );
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async stop() {
    clearInterval(this.timer);
    await this.flush();
  }
}
