import { z } from "zod";

// ---------- shared pieces ----------

export const Mode = z.enum(["off", "paper", "live"]);
export const OnNull = z.enum(["reject", "ignore"]);

const num = z.number().finite();

/** Satu rule filter: `{ field, op, value, on_null? }` */
export const FilterRule = z
  .object({
    field: z.string().min(1),
    op: z.enum(["gte", "lte", "gt", "lt", "eq", "neq", "between", "in", "not_in"]),
    value: z.union([num, z.tuple([num, num]), z.string(), z.boolean(), z.array(z.union([z.string(), num]))]),
    on_null: OnNull.optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.op === "between" &&
      !(Array.isArray(r.value) && r.value.length === 2 && r.value[0]! <= r.value[1]!)
    ) {
      ctx.addIssue({ code: "custom", message: "op 'between' butuh value [min, max] dengan min <= max" });
    }
    if ((r.op === "in" || r.op === "not_in") && !Array.isArray(r.value)) {
      ctx.addIssue({ code: "custom", message: `op '${r.op}' butuh value array` });
    }
  });

export const Timeframe = z.enum(["1s", "15s", "1m", "5m", "15m", "1h", "4h"]);

const MtfLayer = z
  .object({
    tf: Timeframe,
    all: z.array(z.string()).optional(),
    any: z.array(z.string()).optional(),
  })
  .strict()
  .refine((l) => (l.all?.length ?? 0) + (l.any?.length ?? 0) > 0, "layer MTF butuh minimal satu kondisi");

// ---------- exits ----------

export const ExitConfig = z
  .object({
    hard_sl_pct: num.max(0),
    structure_sl: z
      .object({ below: z.string(), buffer_pct: num.min(0) })
      .strict()
      .optional(),
    momentum_fail: z.object({ within_sec: num.positive(), min_gain_pct: num }).strict().optional(),
    break_even: z.object({ activate_at_pct: num.positive(), lock_pct: num }).strict().optional(),
    take_profit_ladder: z
      .array(z.object({ at_pct: num.positive(), sell_pct: num.gt(0).max(100) }).strict())
      .default([]),
    trailing: z
      .union([
        z
          .object({
            tiers: z
              .array(z.object({ activate_at_pct: num.positive(), distance_pct: num.positive() }).strict())
              .min(1),
          })
          .strict(),
        z.object({ mode: z.literal("atr"), tf: Timeframe, k: num.positive() }).strict(),
      ])
      .optional(),
    max_hold_sec: num.positive(),
    stale: z.object({ no_new_high_sec: num.positive(), max_pnl_pct: num }).strict().optional(),
    events: z
      .object({
        dev_sell_pct_gte: num.optional(),
        top_holder_sell_pct_gte: num.optional(),
        liquidity_drop_pct_1m: num.optional(),
        sell_pressure: z
          .object({ window_sec: num.positive(), sell_buy_ratio_gte: num.positive() })
          .strict()
          .optional(),
        security_flag_change: z.boolean().optional(),
      })
      .strict()
      .default({}),
    panic: z
      .object({
        slippage_bps: num.int().positive(),
        priority_multiplier: num.positive(),
        retries: num.int().min(0),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((e, ctx) => {
    const ladder = e.take_profit_ladder;
    for (let i = 1; i < ladder.length; i++) {
      if (ladder[i]!.at_pct <= ladder[i - 1]!.at_pct) {
        ctx.addIssue({
          code: "custom",
          path: ["take_profit_ladder", i],
          message: "at_pct harus naik berurutan",
        });
      }
    }
    if (e.trailing && "tiers" in e.trailing) {
      const t = e.trailing.tiers;
      for (let i = 1; i < t.length; i++) {
        if (t[i]!.activate_at_pct <= t[i - 1]!.activate_at_pct) {
          ctx.addIssue({
            code: "custom",
            path: ["trailing", "tiers", i],
            message: "activate_at_pct harus naik berurutan",
          });
        }
      }
    }
  });

// ---------- strategy.yaml ----------

export const Profile = z
  .object({
    mode: Mode,
    bucket_pct: num.min(0).max(100),
    triggers: z.array(z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/, "format trigger: sumber.jenis")).min(1),
    wait_after_trigger_sec: num.min(0).default(0),
    eval_window_sec: num.positive().default(900),
    filters: z.array(FilterRule).default([]),
    mtf: z
      .object({ trend: MtfLayer.optional(), setup: MtfLayer.optional(), trigger: MtfLayer })
      .strict()
      .optional(),
    score: z
      .object({ threshold: num.min(0).max(100), weights: z.record(z.string(), num) })
      .strict()
      .optional(),
    entry: z.object({ size_sol: num.positive(), max_price_impact_pct: num.positive() }).strict(),
    exits: z.object({ ref: z.string() }).strict(),
  })
  .strict();

export const StrategyConfig = z
  .object({
    version: z.literal(1),
    defaults: z
      .object({
        on_null: OnNull.default("reject"),
        critical_fields: z.array(z.string()).default([]),
        cross_check: z
          .record(
            z.string(),
            z.object({ providers: z.array(z.string()).min(2), max_abs_diff: num.min(0) }).strict(),
          )
          .default({}),
      })
      .strict(),
    profiles: z.record(z.string().regex(/^[a-z0-9_]+$/), Profile),
    exits: z.record(z.string(), ExitConfig),
  })
  .strict()
  .superRefine((c, ctx) => {
    let bucket = 0;
    for (const [name, p] of Object.entries(c.profiles)) {
      if (p.mode !== "off") bucket += p.bucket_pct;
      const ref = p.exits.ref.replace(/^exits\./, "");
      if (!c.exits[ref]) {
        ctx.addIssue({
          code: "custom",
          path: ["profiles", name, "exits", "ref"],
          message: `exit '${ref}' tidak ada di bagian exits`,
        });
      }
    }
    if (bucket > 100)
      ctx.addIssue({
        code: "custom",
        path: ["profiles"],
        message: `total bucket_pct profile aktif ${bucket}% > 100%`,
      });
  });

// ---------- trade.yaml ----------

const HourRange = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, "format HH:MM-HH:MM");

export const TradeConfig = z
  .object({
    mode: z.enum(["paper", "live"]),
    bankroll: z.object({ reference_sol: num.positive(), min_sol_reserve: num.min(0) }).strict(),
    limits: z
      .object({
        max_open_positions: num.int().positive(),
        max_open_per_profile: num.int().positive(),
        max_position_sol: num.positive(),
        max_exposure_sol: num.positive(),
        max_trades_per_day: num.int().positive(),
        reentry_cooldown_min: num.min(0),
        no_averaging_down: z.boolean(),
      })
      .strict(),
    daily: z
      .object({
        max_loss_sol: num.positive(),
        profit_lock_sol: num.positive().optional(),
        profit_lock_action: z.enum(["stop", "halve_size", "none"]).default("none"),
      })
      .strict(),
    trading_hours_utc: z.object({ enabled: z.boolean(), allow: z.array(HourRange) }).strict(),
    circuit_breakers: z
      .object({
        consecutive_losses: z.object({ n: num.int().positive(), pause_min: num.positive() }).strict(),
        drawdown_from_peak_pct: z
          .object({ value: num.positive(), action: z.enum(["pause_profile", "pause_all"]) })
          .strict(),
        data_stale_sec: num.positive(),
        provider_error_rate: z.object({ window_min: num.positive(), max_pct: num.positive() }).strict(),
        rpc_latency_ms_p95: num.positive(),
        exec_fail_rate: z.object({ window: num.int().positive(), max_pct: num.positive() }).strict(),
        slippage_anomaly: z.object({ window: num.int().positive(), avg_extra_bps: num.positive() }).strict(),
      })
      .strict(),
    execution: z
      .object({
        default_route: z.enum(["jupiter_v2_order", "jupiter_v2_build", "pump_direct"]),
        fallback_route: z.enum(["jupiter_v2_order", "jupiter_v2_build", "pump_direct"]),
        slippage_bps_entry: num.int().positive(),
        priority_fee_lamports: z
          .object({ entry: num.int().min(0), exit: num.int().min(0), panic_max: num.int().min(0) })
          .strict(),
        tip_lamports: z.object({ entry: num.int().min(0), exit: num.int().min(0) }).strict(),
        max_fee_pct_of_trade: num.positive(),
        sender: z
          .object({
            url: z.string().url(),
            swqos_only: z.boolean(),
            mev_protect: z.boolean(),
            fallback_region: z.string(),
          })
          .strict(),
        close_ata_after_exit: z.boolean(),
        confirm_timeout_ms: num.int().positive(),
      })
      .strict(),
    paper: z
      .object({
        latency_ms: num.int().min(0),
        p_fail_entry: num.min(0).max(1),
        p_fail_exit: num.min(0).max(1),
      })
      .strict(),
    kill_switch: z
      .object({
        file_flag: z.string().startsWith("/"),
        telegram_admin_chat_ids: z.array(z.union([z.string(), num])),
      })
      .strict(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.limits.max_position_sol > c.limits.max_exposure_sol) {
      ctx.addIssue({
        code: "custom",
        path: ["limits", "max_position_sol"],
        message: "max_position_sol > max_exposure_sol",
      });
    }
    if (c.bankroll.min_sol_reserve >= c.bankroll.reference_sol) {
      ctx.addIssue({ code: "custom", path: ["bankroll", "min_sol_reserve"], message: "reserve >= bankroll" });
    }
  });

// ---------- sources.yaml ----------

export const SourcesConfig = z
  .object({
    pumpportal: z
      .object({
        enabled: z.boolean(),
        ws_url: z.string().url(),
        new_token: z.boolean(),
        migration: z.boolean(),
        token_trades: z.boolean(),
      })
      .strict(),
    dexscreener: z
      .object({
        enabled: z.boolean(),
        base_url: z.string().url(),
        poll_sec: z
          .object({ profiles: num.positive(), boosts_latest: num.positive(), boosts_top: num.positive() })
          .strict(),
        rpm: z.object({ profiles: num.positive(), pairs: num.positive() }).strict(),
        /** proxy URL dari env DEXSCREENER_PROXY_URL; mode menentukan kapan dipakai */
        proxy_mode: z.enum(["off", "fallback", "always"]).default("fallback"),
      })
      .strict(),
    gmgn: z
      .object({
        enabled: z.boolean(),
        poll_sec: num.positive(),
        feeds: z.array(z.enum(["trending", "trenches", "hot", "signal"])),
      })
      .strict(),
    meteora: z.object({ enabled: z.boolean(), poll_sec: num.positive() }).strict(),
    /** wallet tracker: scan top holder & pembeli besar token yang dievaluasi pipeline (data GMGN) */
    wallet_tracker: z
      .object({
        enabled: z.boolean(),
        /** jumlah top holder (urut % supply, tanpa akun pool/exchange) yang dicatat */
        top_n: num.int().positive().max(100),
        /** ambang pembeli besar (USD total beli) — tiap wallet diberi tier tertinggi yang terlewati */
        big_buyer_usd: z.array(num.positive()).min(1),
        /** jumlah holder yang diminta per token (maks 100) */
        fetch_limit: num.int().positive().max(100),
        /** jeda minimal antar scan token (dtk) — endpoint holders berbobot 5 di GMGN */
        min_interval_sec: num.positive(),
        /** token yang sama tidak di-scan ulang dalam jendela ini (menit) */
        rescan_after_min: num.positive(),
        /** tunggu setelah token dievaluasi sebelum scan (dtk) — biar holder terbentuk */
        delay_sec: num.min(0),
      })
      .strict()
      .default({
        enabled: false,
        top_n: 10,
        big_buyer_usd: [500, 1000],
        fetch_limit: 50,
        min_interval_sec: 6,
        rescan_after_min: 360,
        delay_sec: 120,
      }),
    tracker: z
      .object({
        track_minutes: num.positive(),
        max_concurrent_tokens: num.int().positive(),
        tick_flush_ms: num.int().positive(),
      })
      .strict(),
  })
  .strict();

// ---------- llm.yaml ----------

export const LlmConfig = z
  .object({
    enabled: z.boolean(),
    daily_budget_usd: num.min(0),
    models: z
      .object({ default: z.string(), tagger: z.string(), parser: z.string(), review: z.string() })
      .strict(),
    tasks: z
      .object({
        narrative_tagger: z.boolean(),
        telegram_parser: z.boolean(),
        thesis_check: z.boolean(),
        daily_review: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type FilterRule = z.infer<typeof FilterRule>;
export type ExitConfig = z.infer<typeof ExitConfig>;
export type Profile = z.infer<typeof Profile>;
export type StrategyConfig = z.infer<typeof StrategyConfig>;
export type TradeConfig = z.infer<typeof TradeConfig>;
export type SourcesConfig = z.infer<typeof SourcesConfig>;
export type LlmConfig = z.infer<typeof LlmConfig>;

export const configSchemas = {
  strategy: StrategyConfig,
  trade: TradeConfig,
  sources: SourcesConfig,
  llm: LlmConfig,
} as const;

export type ConfigKind = keyof typeof configSchemas;
export type ConfigOf<K extends ConfigKind> = z.infer<(typeof configSchemas)[K]>;
