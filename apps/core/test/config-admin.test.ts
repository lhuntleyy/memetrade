import { afterEach, expect, test } from "bun:test";
import { compactDiff, lineDiff, liveGuard } from "../src/config-admin.ts";

afterEach(() => {
  delete process.env.MEMEBOT_ALLOW_LIVE_CONFIG;
});

test("lineDiff menandai baris dihapus/ditambah", () => {
  const d = lineDiff("a: 1\nb: 2\nc: 3", "a: 1\nb: 5\nc: 3\nd: 4");
  expect(d.split("\n")).toEqual(["  a: 1", "- b: 2", "+ b: 5", "  c: 3", "+ d: 4"]);
});

test("compactDiff hanya menyisakan perubahan + konteks", () => {
  const before = Array.from({ length: 20 }, (_, i) => `k${i}: ${i}`).join("\n");
  const after = before.replace("k10: 10", "k10: 99");
  const c = compactDiff(lineDiff(before, after), 1);
  expect(c.split("\n")).toEqual(["  k9: 9", "- k10: 10", "+ k10: 99", "  k11: 11"]);
});

test("liveGuard menolak mode live kecuali diizinkan env", () => {
  expect(liveGuard("trade", { mode: "live" })).toEqual(["trade.mode = live"]);
  expect(liveGuard("strategy", { profiles: { a: { mode: "paper" }, b: { mode: "live" } } })).toEqual([
    "profiles.b.mode = live",
  ]);
  expect(liveGuard("trade", { mode: "paper" })).toEqual([]);
  process.env.MEMEBOT_ALLOW_LIVE_CONFIG = "1";
  expect(liveGuard("trade", { mode: "live" })).toEqual([]);
});
