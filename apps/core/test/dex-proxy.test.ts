import { afterAll, expect, test } from "bun:test";
import { DexScreenerClient } from "../src/collectors/dexscreener.ts";

// "DexScreener" langsung selalu 429; "proxy" palsu menjawab 200 untuk request apa pun (HTTP proxy, URL absolut)
const direct = Bun.serve({ port: 0, fetch: () => new Response("rate limited", { status: 429 }) });
let proxied = 0;
const proxy = Bun.serve({
  port: 0,
  fetch: () => {
    proxied++;
    return Response.json([{ chainId: "solana", tokenAddress: "M" }]);
  },
});
afterAll(() => {
  direct.stop(true);
  proxy.stop(true);
});
const base = direct.url.href.replace(/\/$/, "");

test("fallback: 429 di jalur langsung → request berikutnya lewat proxy", async () => {
  const c = new DexScreenerClient(base, { profiles: 600, pairs: 600 }, () => {}, {
    url: proxy.url.href,
    mode: "fallback",
  });
  expect(c.route).toBe("direct");
  await expect(c.latestProfiles()).rejects.toThrow("429 via direct");
  expect(c.route).toBe("proxy");
  const items = await c.latestProfiles();
  expect(items).toHaveLength(1);
  expect(proxied).toBeGreaterThan(0);
  expect(c.stats.direct429).toBe(1);
});

test("mode off: setelah 429 semua dijeda (tanpa proxy)", async () => {
  const c = new DexScreenerClient(base, { profiles: 600, pairs: 600 }, () => {}, {
    url: proxy.url.href,
    mode: "off",
  });
  await expect(c.latestProfiles()).rejects.toThrow("429");
  expect(c.route).toBe("paused");
  expect(c.pausedForSec).toBeGreaterThan(0);
  await expect(c.latestProfiles()).rejects.toThrow("dijeda");
});
