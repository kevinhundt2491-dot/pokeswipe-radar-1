// Gründer-Aktion „Die ersten 50 Sammler“ (Datenbank-Teil). Logik & Konstanten: first50-logic.ts.
// Jedes angemeldete, nicht gesperrte Konto sichert sich beim ersten Kontakt mit der API automatisch einen der 50 Plätze,
// solange noch welche frei sind. Ein eindeutiger Index auf profiles.first50_rank verhindert doppelt vergebene Plätze.
// Gutschrift: Platz-Nummer + 60 Tage Pro (über das bestehende Belohnungssystem) + dauerhaftes Gründer-Sammler-Badge.
import { eq, sql } from "drizzle-orm";
import { db, profiles, userBadges } from "../db/index.ts";
import { grantReward } from "./viral.ts";
import { FOUNDER_BADGE } from "./founder-logic.ts";
import { FIRST50_LIMIT, FIRST50_DAYS, FIRST50_BADGE, first50Active, first50Left, first50Headline, first50Pct } from "./first50-logic.ts";
import { rows } from "./util.ts";
import { log } from "./log.ts";

type Profile = typeof profiles.$inferSelect;

// Sind alle Plätze vergeben, wird das im Speicher gemerkt – danach kostet die Prüfung keine Abfrage mehr.
let full = false;
let cached: { taken: number; at: number } | null = null;

export async function first50Taken(): Promise<number> {
  if (cached && Date.now() - cached.at < 20_000) return cached.taken;
  const [r] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM profiles WHERE first50_rank IS NOT NULL`));
  const taken = Number(r?.n ?? 0);
  cached = { taken, at: Date.now() };
  if (taken >= FIRST50_LIMIT) full = true;
  return taken;
}

/** Öffentliche Zahlen für die Fortschrittsbox auf der Startseite. */
export async function first50Stats() {
  const taken = Math.min(FIRST50_LIMIT, await first50Taken());
  return { limit: FIRST50_LIMIT, days: FIRST50_DAYS, taken, left: first50Left(taken), pct: first50Pct(taken), headline: first50Headline(taken) };
}

/**
 * Vergibt (falls frei) einen Gründer-Platz. Gibt das aktualisierte Profil zurück – oder das unveränderte,
 * wenn das Konto schon einen Platz hat, gesperrt ist oder alle Plätze vergeben sind.
 */
export async function claimFirst50(profile: Profile): Promise<Profile> {
  if (full || profile.first50Rank || profile.banned) return profile;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const [won] = rows(await db.execute(sql`
        UPDATE profiles SET first50_rank = sub.n + 1, first50_until = now() + make_interval(days => ${FIRST50_DAYS}::int),
          founder_at = coalesce(founder_at, now())
        FROM (SELECT count(*)::int AS n FROM profiles WHERE first50_rank IS NOT NULL) sub
        WHERE user_id = ${profile.userId} AND first50_rank IS NULL AND NOT banned AND sub.n < ${FIRST50_LIMIT}
        RETURNING first50_rank, first50_until, founder_at`));
      if (!won) {
        cached = null;
        await first50Taken();
        return profile;
      }
      const rank = Number(won.first50_rank);
      cached = null;
      if (rank >= FIRST50_LIMIT) full = true;
      await db.insert(userBadges).values([{ userId: profile.userId, badge: FOUNDER_BADGE }, { userId: profile.userId, badge: FIRST50_BADGE }]).onConflictDoNothing();
      await grantReward(profile.userId, {
        kind: "first50", reference: "", plan: "pro", days: FIRST50_DAYS,
        title: `Gründer-Platz #${rank} von ${FIRST50_LIMIT} gesichert!`,
        text: `Glückwunsch – du gehörst zu den ersten ${FIRST50_LIMIT} Sammlern: Dein Gründer-Sammler-Badge ist dauerhaft aktiv, dazu ${FIRST50_DAYS} Tage Pro mit 0 % Marktplatz-Gebühren, unbegrenzten Scans & Preisalarmen.`,
      }).catch((err) => log.warn("first50", "Pro-Tage nicht gutgeschrieben", { err }));
      const [fresh] = await db.select().from(profiles).where(eq(profiles.userId, profile.userId)).limit(1);
      return fresh ?? { ...profile, first50Rank: rank, first50Until: new Date(won.first50_until), founderAt: new Date(won.founder_at) };
    } catch (err: any) {
      // Zwei Anmeldungen gleichzeitig wollten denselben Platz – neu zählen und erneut versuchen
      if (String(err?.code || err?.cause?.code) === "23505") continue;
      log.warn("first50", "Gründer-Platz nicht vergeben", { err });
      return profile;
    }
  }
  return profile;
}

/** Für /api/me: eigener Gründer-Platz. */
export const first50Me = (p: Pick<Profile, "first50Rank" | "first50Until">) => p.first50Rank
  ? { rank: p.first50Rank, limit: FIRST50_LIMIT, until: p.first50Until, active: first50Active(p) }
  : null;

export function registerFirst50(app: any) {
  app.get("/api/first50", async (c: any) => {
    c.header("Cache-Control", "public, max-age=20");
    try { return c.json(await first50Stats()); }
    catch (err) { log.warn("first50", "Zähler nicht lesbar", { err }); return c.json({ limit: FIRST50_LIMIT, days: FIRST50_DAYS, taken: null, left: null, pct: 0, headline: "" }); }
  });
}
