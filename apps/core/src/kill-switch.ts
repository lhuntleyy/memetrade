import { existsSync } from "node:fs";

/**
 * Kill switch: aktif kalau file flag ada ATAU di-engage lewat control API/Telegram.
 * Aktif = stop entry baru; posisi tetap dikelola exit engine.
 */
export class KillSwitch {
  private manual: string | null = null;
  private fileActive = false;
  private timer: Timer;

  constructor(
    private readonly flagPath: string,
    pollMs = 1000,
  ) {
    this.fileActive = existsSync(flagPath);
    this.timer = setInterval(() => {
      this.fileActive = existsSync(this.flagPath);
    }, pollMs);
  }

  get active(): boolean {
    return this.fileActive || this.manual !== null;
  }

  get reason(): string | null {
    if (this.fileActive) return `file flag ${this.flagPath}`;
    return this.manual;
  }

  engage(reason: string) {
    this.manual = reason;
  }

  /** Lepas kill manual. Kill via file tetap aktif sampai file dihapus. */
  release() {
    this.manual = null;
  }

  stop() {
    clearInterval(this.timer);
  }
}
