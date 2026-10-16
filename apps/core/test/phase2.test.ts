import { describe, expect, test } from "bun:test";
import type { StrategyConfig } from "@memebot/shared";
import { type MintAccount, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "@memebot/solana";
import { dexFeatures, mergeFeatures } from "../src/enrich/features.ts";
import { jupiterFeatures } from "../src/enrich/jupiter.ts";
import { checkMint } from "../src/security/check-mint.ts";
import { evaluateFilters } from "../src/strategy/rules.ts";

const mint = (o: Partial<MintAccount["info"]> = {}, owner = TOKEN_2022_PROGRAM): MintAccount => ({
  owner,
  program: owner === TOKEN_PROGRAM ? "spl-token" : "spl-token-2022",
  info: { decimals: 6, supply: "1", isInitialized: true, mintAuthority: null, freezeAuthority: null, ...o },
});

describe("checkMint", () => {
  test("token pump.fun Token-2022 (metadata saja, authority null) → pass", () => {
    // bentuk asli dari RPC jsonParsed 2026-10-17
    const v = checkMint(
      mint({
        extensions: [
          { extension: "metadataPointer", state: { authority: null, metadataAddress: "X" } },
          { extension: "tokenMetadata", state: { updateAuthority: null, name: "Top Floor" } },
        ],
      }),
    );
    expect(v.verdict).toBe("pass");
    expect(v.program).toBe("token2022");
    expect(v.warnings).toEqual([]);
  });

  test("mint/freeze authority aktif → fail", () => {
    const v = checkMint(mint({ mintAuthority: "A", freezeAuthority: "B" }, TOKEN_PROGRAM));
    expect(v.verdict).toBe("fail");
    expect(v.reasons).toEqual(["mint_authority_active", "freeze_authority_active"]);
  });

  test("extension berbahaya terdeteksi", () => {
    const v = checkMint(
      mint({
        extensions: [
          { extension: "permanentDelegate", state: { delegate: "Evil111" } },
          { extension: "transferFeeConfig", state: { newerTransferFee: { transferFeeBasisPoints: 500 } } },
          { extension: "transferHook", state: { programId: "Hook111", authority: null } },
          { extension: "defaultAccountState", state: { accountState: "frozen" } },
          { extension: "nonTransferable" },
          { extension: "anehBaru" },
        ],
      }),
    );
    expect(v.reasons).toEqual([
      "permanent_delegate",
      "transfer_fee_500bps",
      "transfer_hook_active",
      "default_account_frozen",
      "non_transferable",
      "unknown_extension:anehBaru",
    ]);
  });

  test("fee 0 tapi authority fee ada → warning saja; metadata mutable → warning", () => {
    const v = checkMint(
      mint({
        extensions: [
          {
            extension: "transferFeeConfig",
            state: { transferFeeConfigAuthority: "Auth", newerTransferFee: { transferFeeBasisPoints: 0 } },
          },
          { extension: "tokenMetadata", state: { updateAuthority: "Dev" } },
        ],
      }),
    );
    expect(v.verdict).toBe("pass");
    expect(v.warnings).toEqual(["transfer_fee_authority_can_raise_fee", "metadata_mutable"]);
  });

  test("mint tidak ditemukan / program asing → fail", () => {
    expect(checkMint(null).reasons).toEqual(["mint_not_found"]);
    expect(checkMint(mint({}, "Other111")).reasons[0]).toStartWith("unknown_token_program");
  });
});

const defaults: StrategyConfig["defaults"] = {
  on_null: "reject",
  critical_fields: ["liquidity_usd"],
  cross_check: {},
};

describe("evaluateFilters", () => {
  test("semua alasan gagal dicatat, null mengikuti kebijakan", () => {
    const r = evaluateFilters(
      [
        { field: "liquidity_usd", op: "gte", value: 10000 },
        { field: "mcap_usd", op: "between", value: [50000, 500000] },
        { field: "holders", op: "gte", value: 100 },
        { field: "bundler_pct", op: "lte", value: 20, on_null: "ignore" },
      ],
      { liquidity_usd: 5000, mcap_usd: 600000, holders: null },
      defaults,
    );
    expect(r.passed).toBe(false);
    expect(r.failed).toEqual(["liquidity_usd:gte", "mcap_usd:between", "holders:null"]);
    expect(r.ignoredNull).toEqual(["bundler_pct"]);
  });

  test("critical field null tetap reject walau rule bilang ignore", () => {
    const r = evaluateFilters(
      [{ field: "liquidity_usd", op: "gte", value: 1, on_null: "ignore" }],
      {},
      defaults,
    );
    expect(r.failed).toEqual(["liquidity_usd:null"]);
  });

  test("lolos semua", () => {
    const r = evaluateFilters(
      [
        { field: "x", op: "lt", value: 5 },
        { field: "y", op: "in", value: ["a", "b"] },
      ],
      { x: 1, y: "a" },
      defaults,
    );
    expect(r).toEqual({ passed: true, failed: [], ignoredNull: [] });
  });
});

describe("features", () => {
  test("DexScreener + Jupiter digabung, likuiditas bonding curve fallback ke Jupiter", () => {
    const now = 1_000_000_000;
    const dex = dexFeatures(
      {
        dexId: "pumpfun",
        pairAddress: "P",
        priceNative: "0.000001",
        liquidity: null,
        marketCap: 40000,
        volume: { m5: 1000, h1: 5000 },
        txns: { m5: { buys: 30, sells: 10 } },
        priceChange: { m5: 12 },
        pairCreatedAt: now - 10 * 60_000,
        baseToken: { address: "M" },
      },
      now,
    );
    const jup = jupiterFeatures({
      id: "M",
      holderCount: 200,
      liquidity: 9000,
      organicScore: 12,
      audit: { devBalancePercentage: 3 },
    });
    const f = mergeFeatures(dex, jup);
    expect(f.liquidity_usd).toBe(9000);
    expect(f.mcap_usd).toBe(40000);
    expect(f.buy_sell_ratio_5m).toBe(3);
    expect(f.age_min).toBe(10);
    expect(f.holders).toBe(200);
    expect(f.dev_pct).toBe(3);
    expect(f.top_holders_pct).toBeNull();
  });
});
