export type Source = "pumpportal" | "dexscreener" | "gmgn" | "meteora" | "wallet" | "telegram" | "manual";
export type Stage = "filter" | "security" | "mtf" | "score" | "risk";

export type Event =
  | { t: "TokenTriggered"; mint: string; source: Source; kind: string; ts: number; payload: unknown }
  | { t: "TokenEnriched"; mint: string; snapshot: Record<string, unknown>; missing: string[] }
  | { t: "SecurityChecked"; mint: string; verdict: "pass" | "fail"; reasons: string[] }
  | {
      t: "Decision";
      mint: string;
      profile: string;
      stage: Stage;
      passed: boolean;
      failed: string[];
      score?: number;
    }
  | { t: "Signal"; mint: string; profile: string; score: number }
  | { t: "PriceTick"; mint: string; ts: number; priceSol: number; liquiditySol?: number }
  | { t: "CircuitBreaker"; scope: string; reason: string; until?: number }
  | { t: "Control"; action: "pause" | "resume" | "kill" | "panic" | "reload"; actor: string; scope?: string }
  | { t: "Heartbeat"; service: string; ts: number; lagMs: number; rssMb: number };

export type EventType = Event["t"];
export type EventOf<T extends EventType> = Extract<Event, { t: T }>;
type Handler<T extends EventType> = (e: EventOf<T>) => void | Promise<void>;
type AnyHandler = (e: Event) => void | Promise<void>;

/**
 * Event bus in-memory, typed. Handler error tidak boleh menjatuhkan publisher —
 * dilaporkan ke onError lalu lanjut ke handler berikutnya.
 */
export class EventBus {
  private handlers = new Map<EventType, Set<AnyHandler>>();
  private anyHandlers = new Set<(e: Event) => void>();

  constructor(private onError: (err: unknown, e: Event) => void = () => {}) {}

  on<T extends EventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = handler as unknown as AnyHandler;
    set.add(h);
    return () => set.delete(h);
  }

  /** Dengar semua event (journal, fan-out ke dashboard). */
  onAny(handler: (e: Event) => void): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  emit(e: Event): void {
    for (const h of this.handlers.get(e.t) ?? []) this.call(() => h(e), e);
    for (const h of this.anyHandlers) this.call(() => h(e), e);
  }

  private call(fn: () => void | Promise<void>, e: Event) {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((err) => this.onError(err, e));
    } catch (err) {
      this.onError(err, e);
    }
  }
}
