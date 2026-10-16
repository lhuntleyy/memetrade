/**
 * Login dashboard: satu password (hash Argon2 via Bun.password di env DASHBOARD_PASSWORD_HASH),
 * session = cookie httpOnly berisi token bertanda tangan HMAC (tanpa state server).
 * Lapisan kedua setelah Tailscale — dashboard tetap tidak punya port publik.
 */

const COOKIE = "memebot_session";
const SESSION_TTL_SEC = 7 * 24 * 3600;

export interface AuthOptions {
  passwordHash: string | undefined;
  /** kunci HMAC untuk tanda tangan session */
  sessionKey: string;
  /** set Secure pada cookie (aktifkan kalau diakses lewat HTTPS) */
  secureCookie?: boolean;
}

const enc = new TextEncoder();

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return Buffer.from(sig).toString("base64url");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(key: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SEC;
  const payload = `v1.${exp}`;
  return `${payload}.${await hmac(key, payload)}`;
}

export async function verifySessionToken(
  key: string,
  token: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  return timingSafeEqual(parts[2]!, await hmac(key, `${parts[0]}.${parts[1]}`));
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** Rate limit login sederhana per IP: maks 5 gagal / 15 menit. */
class LoginThrottle {
  private fails = new Map<string, number[]>();
  blocked(ip: string, now = Date.now()) {
    const recent = (this.fails.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
    this.fails.set(ip, recent);
    return recent.length >= 5;
  }
  fail(ip: string, now = Date.now()) {
    this.fails.set(ip, [...(this.fails.get(ip) ?? []), now]);
  }
  reset(ip: string) {
    this.fails.delete(ip);
  }
}

export function createAuth(o: AuthOptions) {
  if (o.sessionKey.length < 32) throw new Error("session key minimal 32 karakter");
  const throttle = new LoginThrottle();
  const cookieAttrs = `Path=/; HttpOnly; SameSite=Strict${o.secureCookie ? "; Secure" : ""}`;

  return {
    enabled: Boolean(o.passwordHash),

    async isAuthed(req: Request): Promise<boolean> {
      if (!o.passwordHash) return true; // belum dikonfigurasi → hanya aman karena bind 127.0.0.1
      return verifySessionToken(o.sessionKey, readCookie(req, COOKIE));
    },

    async login(req: Request, ip: string): Promise<Response> {
      if (!o.passwordHash) return Response.redirect("/", 303);
      if (throttle.blocked(ip))
        return new Response("terlalu banyak percobaan, coba lagi 15 menit", { status: 429 });
      const form = await req.formData().catch(() => null);
      const password = String(form?.get("password") ?? "");
      if (!password || !(await Bun.password.verify(password, o.passwordHash))) {
        throttle.fail(ip);
        return Response.redirect("/login?err=1", 303);
      }
      throttle.reset(ip);
      return new Response(null, {
        status: 303,
        headers: {
          location: "/",
          "set-cookie": `${COOKIE}=${await createSessionToken(o.sessionKey)}; Max-Age=${SESSION_TTL_SEC}; ${cookieAttrs}`,
        },
      });
    },

    logout(): Response {
      return new Response(null, {
        status: 303,
        headers: { location: "/login", "set-cookie": `${COOKIE}=; Max-Age=0; ${cookieAttrs}` },
      });
    },
  };
}

export const LOGIN_PAGE = (err: boolean) => `<!doctype html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>memebot — login</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0e14;color:#d8dee9;font:14px system-ui,sans-serif}
form{background:#131822;border:1px solid #232a37;border-radius:12px;padding:24px;width:min(320px,90vw);display:grid;gap:12px}
input,button{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid #232a37;background:#0b0e14;color:inherit}
button{background:#6aa8ff;color:#0b0e14;border:0;font-weight:600;cursor:pointer}.err{color:#ef5a6f}</style></head>
<body><form method="post" action="/login"><b>memebot</b>${err ? '<span class="err">Password salah</span>' : ""}
<input type="password" name="password" placeholder="Password" autofocus required autocomplete="current-password">
<button type="submit">Masuk</button></form></body></html>`;
