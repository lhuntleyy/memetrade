import { describe, expect, test } from "bun:test";
import { createAuth, createSessionToken, verifySessionToken } from "../src/auth.ts";

const KEY = "k".repeat(40);

describe("session token", () => {
  test("token valid diterima, kedaluwarsa & dipalsukan ditolak", async () => {
    const now = Date.now();
    const t = await createSessionToken(KEY, now);
    expect(await verifySessionToken(KEY, t, now)).toBe(true);
    expect(await verifySessionToken(KEY, t, now + 8 * 24 * 3600 * 1000)).toBe(false);
    expect(await verifySessionToken("x".repeat(40), t, now)).toBe(false);
    const [v, exp, sig] = t.split(".");
    expect(await verifySessionToken(KEY, `${v}.${Number(exp) + 999999}.${sig}`, now)).toBe(false);
    expect(await verifySessionToken(KEY, undefined)).toBe(false);
  });
});

describe("login flow", () => {
  const form = (password: string) => {
    const f = new FormData();
    f.set("password", password);
    return new Request("http://x/login", { method: "POST", body: f });
  };

  test("password benar → cookie session, salah → redirect err, 5x gagal → 429", async () => {
    const auth = createAuth({ passwordHash: await Bun.password.hash("rahasia-123"), sessionKey: KEY });
    const ok = await auth.login(form("rahasia-123"), "1.1.1.1");
    expect(ok.status).toBe(303);
    const cookie = ok.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    const authed = new Request("http://x/api", { headers: { cookie: cookie.split(";")[0]! } });
    expect(await auth.isAuthed(authed)).toBe(true);
    expect(await auth.isAuthed(new Request("http://x/api"))).toBe(false);

    for (let i = 0; i < 5; i++)
      expect((await auth.login(form("salah"), "2.2.2.2")).headers.get("location")).toContain("err");
    expect((await auth.login(form("rahasia-123"), "2.2.2.2")).status).toBe(429);
  });
});
