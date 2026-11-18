// „Freunde einladen & Karten hochladen“ – Gründer-Sammler-Belohnung (Datenbank-Teil).
// Zählt eigene Karten-Uploads (Binder-Einträge + Karten-Inserate) und erfolgreiche Einladungs-Anmeldungen,
// speichert beide Zähler dauerhaft im Nutzerprofil und schaltet ab 5 Uploads ODER 1 Anmeldung automatisch frei:
// Badge „Gründer-Sammler“ (Chat & Marktplatz), Gratis-Boosts und erweiterte Preis-Alarme. Logik: founder-logic.ts.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, profiles, userBadges } from "../db/index.ts";

type Profile = typeof profiles.$inferSelect;
import { notify } from "./prices.ts";
import { rows } from "./util.ts";
import { log } from "./log.ts";
import {
  founderQualifies, founderStatus, monotonic, FOUNDER_BADGE, FOUNDER_LABEL, FOUNDER_ICON, FOUNDER_PERKS, INVITE_CALL,
  FOUNDER_FREE_BOOSTS, FOUNDER_EXTRA_ALERTS, type FounderStatus,
} from "./founder-logic.ts";

export const isFounder = (p: Pick<Profile, "founderAt"> | null | undefined) => Boolean(p?.founderAt);

/** Aktuelle Zahlen aus den Tabellen (Binder-Einträge mit Karte/Bild + Karten-Inserate, angemeldete geworbene Nutzer). */
async function countsFor(userId: string) {
  const [r] = rows(await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM portfolio_items WHERE user_id = ${userId} AND (card_id IS NOT NULL OR image <> '')) AS binder,
      (SELECT count(*)::int FROM listings WHERE user_id = ${userId} AND sealed_product_id IS NULL AND status IN ('active','sold')) AS listed,
      (SELECT count(*)::int FROM profiles WHERE referred_by = ${userId} AND NOT banned) AS signups
  `));
  return { uploads: Number(r?.binder ?? 0) + Number(r?.listed ?? 0), signups: Number(r?.signups ?? 0) };
}

/**
 * Zähler neu berechnen, monoton im Profil speichern und – falls erreicht – die Gründer-Vorteile einmalig freischalten.
 * Gibt den Status für die Fortschrittsanzeige zurück.
 */
export async function syncFounder(userId: string): Promise<FounderStatus & { fresh: boolean }> {
  const [p] = await db.select({ cardUploads: profiles.cardUploads, referralSignups: profiles.referralSignups, founderAt: profiles.founderAt, banned: profiles.banned })
    .from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (!p) return { ...founderStatus({ uploads: 0, signups: 0 }), fresh: false };
  const now = await countsFor(userId);
  const uploads = monotonic(p.cardUploads, now.uploads), signups = monotonic(p.referralSignups, now.signups);
  let founderAt = p.founderAt, fresh = false;
  if (uploads !== p.cardUploads || signups !== p.referralSignups) {
    await db.update(profiles).set({ cardUploads: uploads, referralSignups: signups }).where(eq(profiles.userId, userId));
  }
  if (!founderAt && !p.banned && founderQualifies(uploads, signups)) {
    // Nur ein Aufruf gewinnt (parallele Anfragen schalten nicht doppelt frei)
    const [won] = await db.update(profiles).set({ founderAt: new Date() })
      .where(and(eq(profiles.userId, userId), isNull(profiles.founderAt))).returning({ at: profiles.founderAt });
    if (won) {
      founderAt = won.at; fresh = true;
      await db.insert(userBadges).values({ userId, badge: FOUNDER_BADGE }).onConflictDoNothing();
      await notify(userId, `${FOUNDER_ICON} ${FOUNDER_LABEL} freigeschaltet!`,
        `Danke, dass du den Marktplatz mit aufbaust: ${FOUNDER_FREE_BOOSTS} Gratis-Boosts pro Monat, +${FOUNDER_EXTRA_ALERTS} Preis-Alarme und dein verifiziertes Badge im Chat & Marktplatz sind aktiv.`,
        "/?tab=home").catch(() => {});
    }
  }
  return { ...founderStatus({ uploads, signups, founderAt }), fresh };
}

/** Für den Middleware-Aufruf nach Uploads: Fehler nie an den Nutzer durchreichen. */
export const syncFounderQuiet = (userId: string) => syncFounder(userId).catch((err) => { log.warn("founder", "Gründer-Status nicht aktualisiert", { err }); return null; });

/** Daten für /api/me und /api/founder. */
export async function founderInfo(userId: string) {
  const s = await syncFounder(userId);
  return { ...s, call: INVITE_CALL, perks: FOUNDER_PERKS, label: FOUNDER_LABEL, icon: FOUNDER_ICON };
}

export function registerFounder(app: any, h: { auth: any }) {
  app.get("/api/founder", h.auth, async (c: any) => {
    c.header("Cache-Control", "no-store");
    return c.json(await founderInfo(c.get("user").id));
  });
}
