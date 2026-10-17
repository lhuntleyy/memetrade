import { type Db, pgTextArray } from "@memebot/db";
import type { EventBus, EventOf, Logger, Stage, StrategyConfig } from "@memebot/shared";
import type { SolanaRpc } from "@memebot/solana";
import { dexFeatures, type Features, mergeFeatures } from "../enrich/features.ts";
import { type GmgnClient, type GmgnData, gmgnFeatures, gmgnSecurityReasons } from "../enrich/gmgn.ts";
import { type JupiterTokens, type JupToken, jupiterFeatures } from "../enrich/jupiter.ts";
import { BatchWriter } from "../journal/batch.ts";
import type { MarketTracker } from "../market/tracker.ts";
import { checkMint, type MintVerdict } from "../security/check-mint.ts";
import { evaluateFilters } from "./rules.ts";

interface DecisionRow {
  ts: Date;
  mint: string;
  profile: string;
  stage: Stage;
  passed: boolean;
  failed_rules: string;
  features: Record<string, unknown>;
  score: number | null;
  config_version: number | null;
  trigger_source: string;
  trigger_ts: Date;
}

interface Job {
  mint: string;
  profile: string;
  triggerSource: string;
  triggerTs: number;
  attempts: number;
  /** jumlah evaluasi ulang yang sudah dilakukan (profile dengan reeval_interval_sec) */
  evals: number;
  /** fitur tambahan yang dibawa trigger (mis. smart_confluence_count) */
  extra: Features;
}

export interface PipelineDeps {
  bus: EventBus;
  db: Db;
  log: Logger;
  tracker: MarketTracker;
  jupiter: JupiterTokens;
  /** null kalau GMGN_API_KEY tidak di-set */
  gmgn: GmgnClient | null;
  rpc: SolanaRpc;
  strategy: () => StrategyConfig;
  strategyVersion: () => number;
}

const PAIR_RETRY_MS = 20_000;
const MAX_PAIR_ATTEMPTS = 4;
const MAX_CONCURRENT = 3;
const SECURITY_TTL_MS = 10 * 60_000;
const JUP_TTL_MS = 60_000;

/**
 * Pipeline Fase 2 (tanpa entry): trigger → tunggu → enrichment → security → filter → decision log.
 * Token yang lolos semua tahap menghasilkan event `Signal` (dipakai paper trading di Fase 3).
 * MTF belum dievaluasi (butuh candle dari trade stream).
 */
export class Pipeline {
  private queue: Job[] = [];
  private running = 0;
  private timers = new Set<Timer>();
  private secCache = new Map<string, { v: MintVerdict; at: number }>();
  private jupCache = new Map<string, { v: JupToken | null; at: number }>();
  private gmgnCache = new Map<string, { v: GmgnData | null; at: number }>();
  private decisions: BatchWriter<DecisionRow>;
  private stopped = false;
  stats = {
    scheduled: 0,
    evaluated: 0,
    securityFail: 0,
    filterFail: 0,
    signals: 0,
    errors: 0,
    noPair: 0,
    queue: 0,
    preRetries: 0,
    reevals: 0,
  };

  constructor(private readonly d: PipelineDeps) {
    this.decisions = new BatchWriter<DecisionRow>(
      "decisions",
      async (rows) => {
        await d.db`INSERT INTO decisions ${d.db(rows)}`;
      },
      d.log,
      2000,
    );
    d.bus.on("TokenTriggered", (e) => this.onTrigger(e));
  }

  private onTrigger(e: EventOf<"TokenTriggered">) {
    if (this.stopped || (e.payload as { backlog?: boolean } | null)?.backlog) return;
    const key = `${e.source}.${e.kind}`;
    const extra = ((e.payload as { features?: Features } | null)?.features ?? {}) as Features;
    for (const [name, p] of Object.entries(this.d.strategy().profiles)) {
      if (p.mode === "off" || !p.triggers.includes(key)) continue;
      this.stats.scheduled++;
      const job: Job = {
        mint: e.mint,
        profile: name,
        triggerSource: key,
        triggerTs: e.ts,
        attempts: 0,
        evals: 0,
        extra,
      };
      this.later(() => this.enqueue(job), p.wait_after_trigger_sec * 1000);
    }
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private enqueue(job: Job) {
    if (this.stopped) return;
    this.queue.push(job);
    this.stats.queue = this.queue.length;
    this.pump();
  }

  private pump() {
    while (this.running < MAX_CONCURRENT && this.queue.length) {
      const job = this.queue.shift()!;
      this.stats.queue = this.queue.length;
      this.running++;
      this.evaluate(job)
        .catch((err) => {
          this.stats.errors++;
          this.d.log.warn({ mint: job.mint, profile: job.profile, err: String(err) }, "evaluasi gagal");
        })
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  private async evaluate(job: Job) {
    const profile = this.d.strategy().profiles[job.profile];
    if (!profile || profile.mode === "off") return;

    // butuh data pasar DexScreener (likuiditas, volume) — tunggu sampai ter-index
    const pair = this.d.tracker.latestPair(job.mint);
    if (!pair && job.attempts + 1 < MAX_PAIR_ATTEMPTS) {
      job.attempts++;
      this.later(() => this.enqueue(job), PAIR_RETRY_MS);
      return;
    }
    if (!pair) this.stats.noPair++;

    const now = Date.now();
    const defaults = this.d.strategy().defaults;
    // evaluasi ulang: token yang belum memenuhi filter dicek lagi tiap reeval_interval_sec selama eval_window_sec
    const interval = profile.reeval_interval_sec * 1000;
    const canRetry = interval > 0 && now + interval <= job.triggerTs + profile.eval_window_sec * 1000;
    const retry = () => {
      job.evals++;
      this.later(() => this.enqueue(job), interval);
    };
    if (canRetry) {
      // pre-check GRATIS dari data DexScreener (cache tracker) sebelum memanggil Jupiter/GMGN/RPC
      const dex = dexFeatures(pair, now);
      const dexRules = profile.filters.filter((r) => dex[r.field] !== undefined && dex[r.field] !== null);
      if (!evaluateFilters(dexRules, dex, defaults).passed) {
        this.stats.preRetries++;
        retry();
        return;
      }
    }

    const [jup, secOnchain, gm] = await Promise.all([
      this.jupiterCached(job.mint),
      this.securityCached(job.mint),
      this.gmgnCached(job.mint),
    ]);
    // GMGN dulu untuk distribusi holder (top10/bundler/sniper), DexScreener untuk pasar, Jupiter untuk holders/organic
    const features: Features = mergeFeatures(
      job.extra,
      dexFeatures(pair, now),
      gmgnFeatures(gm),
      jupiterFeatures(jup),
    );
    const gmReasons = gmgnSecurityReasons(gm);
    const sec = {
      ...secOnchain,
      reasons: [...secOnchain.reasons, ...gmReasons],
      verdict:
        secOnchain.verdict === "pass" && gmReasons.length === 0 ? ("pass" as const) : ("fail" as const),
    };
    this.stats.evaluated++;

    const base = {
      ts: new Date(now),
      mint: job.mint,
      profile: job.profile,
      score: null,
      config_version: this.d.strategyVersion(),
      trigger_source: job.triggerSource,
      trigger_ts: new Date(job.triggerTs),
    };

    const f = evaluateFilters(profile.filters, features, defaults);
    if (sec.verdict === "pass" && !f.passed && canRetry) {
      // belum memenuhi syarat tapi masih dalam window → coba lagi nanti (tidak dicatat sebagai keputusan final)
      this.stats.reevals++;
      retry();
      return;
    }

    // 1) security
    const secRow: DecisionRow = {
      ...base,
      stage: "security",
      passed: sec.verdict === "pass",
      failed_rules: pgTextArray(sec.reasons),
      features: { warnings: sec.warnings, program: sec.program, extensions: sec.extensions },
    };
    this.decisions.push(secRow);
    this.d.bus.emit({
      t: "Decision",
      mint: job.mint,
      profile: job.profile,
      stage: "security",
      passed: secRow.passed,
      failed: sec.reasons,
    });
    if (!secRow.passed) {
      this.stats.securityFail++;
      // tetap evaluasi filter (dicatat) supaya shadow analysis lengkap, tapi hasil akhir = gagal
    }

    // 2) filter (hasil final: lolos, atau window evaluasi habis)
    this.decisions.push({
      ...base,
      stage: "filter",
      passed: f.passed,
      failed_rules: pgTextArray(f.failed),
      features: {
        ...features,
        _ignored_null: f.ignoredNull,
        _pair_found: Boolean(pair),
        _evals: job.evals + 1,
        _sec_after_trigger: Math.round((now - job.triggerTs) / 1000),
      },
    });
    this.d.bus.emit({
      t: "Decision",
      mint: job.mint,
      profile: job.profile,
      stage: "filter",
      passed: f.passed,
      failed: f.failed,
    });
    if (!f.passed) this.stats.filterFail++;

    if (secRow.passed && f.passed) {
      this.stats.signals++;
      this.d.bus.emit({ t: "Signal", mint: job.mint, profile: job.profile, score: 0 });
      this.d.log.info({ mint: job.mint, profile: job.profile }, "SIGNAL");
    }
  }

  private async securityCached(mint: string): Promise<MintVerdict> {
    const c = this.secCache.get(mint);
    if (c && Date.now() - c.at < SECURITY_TTL_MS) return c.v;
    let v: MintVerdict;
    try {
      v = checkMint(await this.d.rpc.getMint(mint));
    } catch (err) {
      // RPC gagal = data tidak ada = tidak lolos (missing data is never good news)
      v = { ...checkMint(null), reasons: [`rpc_error:${String(err).slice(0, 80)}`] };
    }
    this.secCache.set(mint, { v, at: Date.now() });
    if (this.secCache.size > 5000) this.secCache.delete(this.secCache.keys().next().value!);
    await this.d.db`
      INSERT INTO security_reports (mint, mint_authority, freeze_authority, extensions, verdict, reasons)
      VALUES (${mint}, ${v.mintAuthority}, ${v.freezeAuthority}, ${{ list: v.extensions, warnings: v.warnings, program: v.program }}, ${v.verdict}, ${pgTextArray(v.reasons)})`;
    return v;
  }

  private async gmgnCached(mint: string): Promise<GmgnData | null> {
    if (!this.d.gmgn) return null;
    const c = this.gmgnCache.get(mint);
    if (c && Date.now() - c.at < JUP_TTL_MS) return c.v;
    let v: GmgnData | null = null;
    try {
      v = await this.d.gmgn.token(mint);
    } catch (err) {
      this.d.log.debug({ mint, err: String(err) }, "gmgn gagal");
    }
    this.gmgnCache.set(mint, { v, at: Date.now() });
    if (this.gmgnCache.size > 5000) this.gmgnCache.delete(this.gmgnCache.keys().next().value!);
    return v;
  }

  private async jupiterCached(mint: string): Promise<JupToken | null> {
    const c = this.jupCache.get(mint);
    if (c && Date.now() - c.at < JUP_TTL_MS) return c.v;
    let v: JupToken | null = null;
    try {
      v = await this.d.jupiter.token(mint);
    } catch (err) {
      this.d.log.debug({ mint, err: String(err) }, "jupiter gagal");
    }
    this.jupCache.set(mint, { v, at: Date.now() });
    if (this.jupCache.size > 5000) this.jupCache.delete(this.jupCache.keys().next().value!);
    return v;
  }

  async stop() {
    this.stopped = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await this.decisions.stop();
  }
}
