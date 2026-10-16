import type { FilterRule, StrategyConfig } from "@memebot/shared";
import type { Features, FeatureValue } from "../enrich/features.ts";

export interface FilterResult {
  passed: boolean;
  /** format: `field:op` (nilai gagal kondisi) atau `field:null` (data kosong & kebijakan reject) */
  failed: string[];
  /** field yang null tapi diabaikan (on_null: ignore) — dicatat supaya ketahuan data apa yang bolong */
  ignoredNull: string[];
}

function cmp(op: FilterRule["op"], v: FeatureValue, target: FilterRule["value"]): boolean {
  switch (op) {
    case "gte":
      return typeof v === "number" && typeof target === "number" && v >= target;
    case "lte":
      return typeof v === "number" && typeof target === "number" && v <= target;
    case "gt":
      return typeof v === "number" && typeof target === "number" && v > target;
    case "lt":
      return typeof v === "number" && typeof target === "number" && v < target;
    case "eq":
      return v === target;
    case "neq":
      return v !== target;
    case "between":
      return (
        typeof v === "number" &&
        Array.isArray(target) &&
        typeof target[0] === "number" &&
        typeof target[1] === "number" &&
        v >= target[0] &&
        v <= target[1]
      );
    case "in":
      return Array.isArray(target) && (target as unknown[]).includes(v);
    case "not_in":
      return Array.isArray(target) && !(target as unknown[]).includes(v);
  }
}

/**
 * Evaluasi semua rule (tidak berhenti di kegagalan pertama — semua alasan dicatat untuk analisa).
 * Kebijakan null: rule.on_null → defaults.on_null; field di `critical_fields` SELALU reject kalau null.
 */
export function evaluateFilters(
  rules: FilterRule[],
  features: Features,
  defaults: StrategyConfig["defaults"],
): FilterResult {
  const failed: string[] = [];
  const ignoredNull: string[] = [];
  const critical = new Set(defaults.critical_fields);

  for (const r of rules) {
    const v = features[r.field];
    if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) {
      const policy = critical.has(r.field) ? "reject" : (r.on_null ?? defaults.on_null);
      if (policy === "reject") failed.push(`${r.field}:null`);
      else ignoredNull.push(r.field);
      continue;
    }
    if (!cmp(r.op, v, r.value)) failed.push(`${r.field}:${r.op}`);
  }
  return { passed: failed.length === 0, failed, ignoredNull };
}
