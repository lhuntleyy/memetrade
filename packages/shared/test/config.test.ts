import { describe, expect, test } from "bun:test";
import { ConfigError, configSchemas, effectiveMode, loadConfig, parseConfig } from "../src/index.ts";

describe("config files di repo", () => {
  for (const kind of Object.keys(configSchemas) as (keyof typeof configSchemas)[]) {
    test(`${kind}.yaml valid`, async () => {
      const c = await loadConfig(kind);
      expect(c.hash).toHaveLength(64);
    });
  }

  test("default global mode = paper (jangan live tanpa sengaja)", async () => {
    const trade = await loadConfig("trade");
    expect(trade.data.mode).toBe("paper");
  });
});

const minimalStrategy = (patch: string) => `
version: 1
defaults: {}
profiles:
  p1:
    mode: paper
    bucket_pct: 50
    triggers: [pumpportal.migration]
    entry: { size_sol: 0.1, max_price_impact_pct: 2 }
    exits: { ref: exits.e1 }
${patch}
exits:
  e1: { hard_sl_pct: -10, max_hold_sec: 60 }
`;

describe("validasi strategy", () => {
  test("config minimal lolos + default terisi", () => {
    const c = parseConfig("strategy", minimalStrategy(""));
    expect(c.data.defaults.on_null).toBe("reject");
    expect(c.data.profiles.p1!.filters).toEqual([]);
  });

  test("between harus [min, max]", () => {
    const y = minimalStrategy("").replace(
      "    entry:",
      "    filters:\n      - { field: mcap_usd, op: between, value: [5, 1] }\n    entry:",
    );
    expect(() => parseConfig("strategy", y)).toThrow(/min <= max/);
  });

  test("exit ref harus ada", () => {
    const y = minimalStrategy("").replace("exits.e1", "exits.tidak_ada");
    expect(() => parseConfig("strategy", y)).toThrow(/tidak ada di bagian exits/);
  });

  test("total bucket profile aktif <= 100%", () => {
    const y = minimalStrategy("").replace("bucket_pct: 50", "bucket_pct: 150");
    expect(() => parseConfig("strategy", y)).toThrow();
  });

  test("ladder TP harus naik", () => {
    const y = minimalStrategy("").replace(
      "e1: { hard_sl_pct: -10, max_hold_sec: 60 }",
      "e1: { hard_sl_pct: -10, max_hold_sec: 60, take_profit_ladder: [{ at_pct: 50, sell_pct: 50 }, { at_pct: 20, sell_pct: 50 }] }",
    );
    expect(() => parseConfig("strategy", y)).toThrow(/naik berurutan/);
  });

  test("field tak dikenal ditolak (typo ketahuan)", () => {
    const y = minimalStrategy("").replace("hard_sl_pct: -10", "hard_sl_pc: -10");
    expect(() => parseConfig("strategy", y)).toThrow(ConfigError);
  });

  test("YAML rusak → ConfigError", () => {
    expect(() => parseConfig("strategy", "version: [1")).toThrow(/YAML rusak/);
  });
});

describe("effectiveMode", () => {
  test("global paper menang atas profile live", () => {
    expect(effectiveMode("paper", "live")).toBe("paper");
    expect(effectiveMode("live", "live")).toBe("live");
    expect(effectiveMode("live", "off")).toBe("off");
  });
});
