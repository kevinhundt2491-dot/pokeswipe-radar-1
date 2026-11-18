// PokeSwipe & Radar – Dauer-Anmeldung (180 Tage, gleitend) ohne ungewollten Rauswurf.
//  POST   /api/session          – nach Login & jedem Token-Refresh: HttpOnly-Sitzungs-Cookie setzen/verlängern
//  POST   /api/session/restore  – Browser-Sitzung fehlt (Safari-ITP, In-App-Browser, gelöschter Speicher): aus Cookie erneuern
//  DELETE /api/session          – NUR beim aktiven Klick auf „Abmelden“: Cookies löschen
// Reine Logik: server/session-logic.ts
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { authenticate, identityOrigin } from "./auth.ts";
import { rateLimit, clientIp } from "./util.ts";
import { log } from "./log.ts";
import {
  SESSION_COOKIE, sessionCookieLines, clearSessionCookieLines, validRefreshToken, classifyRefresh,
} from "./session-logic.ts";

type Hlp = { body: (c: any) => Promise<Record<string, any>> };

const isSecure = (c: Context) => {
  const u = new URL(c.req.url);
  return !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
};

function setCookies(c: Context, lines: string[]) {
  for (const line of lines) c.header("Set-Cookie", line, { append: true });
  c.header("Cache-Control", "no-store");
}

export function registerSession(app: any, { body }: Hlp) {
  // Login / Token-Refresh / regelmäßige Verlängerung (gleitender Ablauf: jedes Mal wieder 180 Tage)
  app.post("/api/session", async (c: Context) => {
    const { user, unavailable } = await authenticate(c);
    if (!user && unavailable) return c.json({ ok: false, retry: true }, 503);
    if (!user) return c.json({ ok: false, error: "Bitte melde dich an." }, 401);
    const b = await body(c);
    const header = c.req.header("authorization") || "";
    const accessToken = header.startsWith("Bearer ") ? header.slice(7) : getCookie(c, "nf_jwt") || "";
    const refreshToken = validRefreshToken(b.refreshToken) ? b.refreshToken : "";
    setCookies(c, sessionCookieLines({ accessToken, refreshToken }, { secure: isSecure(c) }));
    return c.json({ ok: true, persistent: Boolean(refreshToken), maxAgeDays: 180 });
  });

  // Browser hat keine gespeicherte Sitzung mehr, das HttpOnly-Cookie aber schon → neue Tokens holen
  app.post("/api/session/restore", async (c: Context) => {
    const rt = getCookie(c, SESSION_COOKIE) || "";
    if (!validRefreshToken(rt)) return c.json({ restored: false });
    if (!(await rateLimit(`sess:${clientIp(c)}`, 20, 60_000))) return c.json({ restored: false, retry: true }, 429);
    let status: number | null = null;
    let data: any = null;
    try {
      const res = await fetch(`${identityOrigin(c)}/.netlify/identity/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}`,
        signal: AbortSignal.timeout(8_000),
      });
      status = res.status;
      if (res.ok) data = await res.json().catch(() => null);
    } catch {
      status = null;
    }
    const kind = classifyRefresh(status);
    if (kind === "ok" && data?.access_token) {
      setCookies(c, sessionCookieLines({ accessToken: String(data.access_token), refreshToken: String(data.refresh_token || "") }, { secure: isSecure(c) }));
      return c.json({ restored: true });
    }
    if (kind === "invalid") {
      // Refresh-Token widerrufen (z. B. Passwort geändert, auf anderem Weg abgemeldet) → Cookie aufräumen
      setCookies(c, clearSessionCookieLines({ secure: isSecure(c) }));
      return c.json({ restored: false, reason: "invalid" });
    }
    log.warn("session", "Sitzungs-Wiederherstellung: Identity nicht erreichbar", { status });
    c.header("Retry-After", "3");
    return c.json({ restored: false, retry: true }, 503);
  });

  // Aktives Abmelden: einziger Weg, auf dem das Dauer-Cookie gelöscht wird
  app.delete("/api/session", (c: Context) => {
    setCookies(c, clearSessionCookieLines({ secure: isSecure(c) }));
    return c.json({ ok: true });
  });
}
