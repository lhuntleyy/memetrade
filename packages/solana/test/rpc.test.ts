import { afterAll, expect, test } from "bun:test";
import { SolanaRpc } from "../src/index.ts";

// dua server lokal: satu selalu 429 ("max usage reached"), satu sehat
const bad = Bun.serve({ port: 0, fetch: () => new Response("max usage reached", { status: 429 }) });
const good = Bun.serve({
  port: 0,
  fetch: async (req) => {
    const body = (await req.json()) as { id: number };
    return Response.json({ jsonrpc: "2.0", id: body.id, result: 123 });
  },
});
afterAll(() => {
  bad.stop(true);
  good.stop(true);
});

test("fallback ke endpoint berikutnya saat 429, endpoint gagal diistirahatkan", async () => {
  const rpc = new SolanaRpc([bad.url.href, good.url.href]);
  expect(await rpc.call<number>("getSlot", [])).toBe(123);
  expect(rpc.hosts()[0]!.coolingDown).toBe(true);
  expect(rpc.hosts()[1]!.coolingDown).toBe(false);
});

test("error JSON-RPC non-retryable tidak di-fallback", async () => {
  const errSrv = Bun.serve({
    port: 0,
    fetch: () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid param" } }),
  });
  const rpc = new SolanaRpc([errSrv.url.href, good.url.href]);
  await expect(rpc.call("getAccountInfo", ["x"])).rejects.toThrow("invalid param");
  errSrv.stop(true);
});
