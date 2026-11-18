// Creator-Programm: öffentliche Bewerbung (/creator), Creator-Finder & kontrollierter Outreach in der Admin-Zentrale.
// Versand nur über Resend, nur nach Freigabe durch den Admin, mit Tageslimit (15), Abstand zwischen Mails,
// Abmelde-Link (List-Unsubscribe) und Sperrliste. Reine Regeln in server/creator-logic.ts.
import { createHash, randomBytes } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, profiles, promoCodes, creatorApplications, creatorLeads, creatorOutreachLog, creatorSuppressions } from "../db/index.ts";
import {
  CREATOR_PLATFORMS, CREATOR_CATEGORIES, CREATOR_PROMO_DAYS, OUTREACH_DAILY_CAP, OUTREACH_MIN_GAP_MS, FOLLOWUP_AFTER_DAYS, STARTER_LEADS,
  TEMPLATES, TEMPLATE_IDS, FOLLOWUP_TEMPLATE, PLATFORM_LABEL, CATEGORY_LABEL, TIER_LABEL, LEAD_STATUSES,
  tierOf, responseScore, suggestPromoCode, cleanWishCode, researchLinks, chooseTemplate, fillTemplate, creatorLink, legalFooter,
  displayStatus, canSendNow, staggerSchedule, checkFetchUrl, isPlatformHost, isPrivateIp, extractContacts, type TemplateId,
  FEATURED_CREATORS, TIKTOK_NICHE_SEARCHES, TIKTOK_DM, tiktokProfileUrl, creatorPage,
  OUTREACH_BULK_DAILY_CAP, BULK_SEND_GAP_MS, parseCreatorImport, linkHubLabel, isLinkHub,
} from "./creator-logic.ts";
import { hasMx } from "./creator-email-finder.ts";
import { PROMO_RE } from "./referral-logic.ts";
import { adminEmails } from "./alerts.ts";
import { mailConfigured, sendMail } from "./legal.ts";
import { notify } from "./prices.ts";
import { SITE, h } from "./growth.ts";
import { str, int, rows, rateLimit, clientIp } from "./util.ts";
import { log } from "./log.ts";

type Hlp = { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> };
type Lead = typeof creatorLeads.$inferSelect;

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const site = () => SITE().replace(/\/$/, "");
const senderName = () => String(process.env.OUTREACH_SENDER_NAME || "").trim();
const optoutUrl = (token: string) => `${site()}/api/creator/optout?t=${encodeURIComponent(token)}`;
const newToken = () => randomBytes(18).toString("base64url");
const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase().slice(0, 160);
const cleanUrl = (v: unknown) => {
  const s = str(v, 400);
  if (!s) return "";
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return /^https?:$/.test(u.protocol) ? u.toString() : ""; } catch { return ""; }
};

// ---------------------------------------------------------------------------
// Promo-Codes für Creator
// ---------------------------------------------------------------------------
/** Legt einen freien Code an (Wunsch → DARIO30 → DARIO302 …) und gibt ihn zurück. */
async function createCreatorPromo(wish: string, label: string, active: boolean, createdBy: string) {
  const base = wish && PROMO_RE.test(wish) ? wish : suggestPromoCode(label);
  for (let i = 0; i < 12; i++) {
    const code = i === 0 ? base : `${base.slice(0, 22)}${i + 1}`.slice(0, 24);
    if (!PROMO_RE.test(code)) continue;
    const [created] = await db.insert(promoCodes).values({
      code, label: label.slice(0, 80), days: CREATOR_PROMO_DAYS, maxRedemptions: null, active, createdBy: createdBy.slice(0, 120),
    }).onConflictDoNothing().returning();
    if (created) return created;
  }
  return null;
}

const mailVars = (l: Pick<Lead, "name" | "promoCode">) => ({
  name: l.name, code: l.promoCode, link: l.promoCode ? creatorLink(site(), l.promoCode) : creatorPage(site()), sender: senderName(), page: creatorPage(site()),
});
function composeMail(l: Pick<Lead, "name" | "promoCode" | "template"> & { platform?: string }) {
  const t = TEMPLATES[(TEMPLATE_IDS.includes(l.template as TemplateId) ? l.template : "A") as TemplateId];
  const v = mailVars(l);
  // TikTok-Creator bekommen die kurze, lockere DM (meist kein E-Mail-Kontakt)
  return { subject: fillTemplate(t.subject, v), body: fillTemplate(t.body, v), dm: fillTemplate(l.platform === "tiktok" ? TIKTOK_DM : t.dm, v) };
}
/** Aktueller Anschreiben-Text: eigener Text bleibt, sonst immer die aktuelle Vorlage (inkl. /creator-Link). */
const currentMail = (l: Lead) => (l.customBody ? { subject: l.subject, body: l.body } : composeMail(l));

async function createLead(input: {
  name: string; category: string; platform: string; channelUrl?: string; followers?: number; email?: string; notes?: string;
  placeholder?: boolean; source?: string; status?: string; promoId?: number | null; promoCode?: string; template?: string; createdBy: string; withPromo?: boolean;
  socials?: string[]; emailSource?: string; emailVerified?: boolean;
}) {
  let promoId = input.promoId ?? null, promoCode = input.promoCode ?? "";
  if (!promoId && input.withPromo !== false && !input.placeholder) {
    const p = await createCreatorPromo("", input.name, true, input.createdBy);
    if (p) { promoId = p.id; promoCode = p.code; }
  }
  const followers = Math.max(0, Math.round(Number(input.followers) || 0));
  const template = (TEMPLATE_IDS as string[]).includes(String(input.template)) ? String(input.template) : chooseTemplate(input.category, followers);
  const mail = composeMail({ name: input.name, promoCode, template, platform: input.platform });
  const [lead] = await db.insert(creatorLeads).values({
    name: input.name.slice(0, 80), category: input.category, platform: input.platform, channelUrl: input.channelUrl ?? "", followers,
    email: input.email ?? "", emailSource: (input.emailSource ?? "").slice(0, 200), emailVerifiedAt: input.emailVerified ? new Date() : null,
    socials: (input.socials ?? []).slice(0, 16), promoId, promoCode, template, subject: mail.subject, body: mail.body, status: input.status ?? "ready",
    placeholder: Boolean(input.placeholder), source: input.source ?? "manual", notes: (input.notes ?? "").slice(0, 1000), optoutToken: newToken(),
  }).returning();
  return lead;
}

/**
 * Feste Creator (FEATURED_CREATORS) idempotent sicherstellen:
 * • Eintrag mit gleichem Namen vorhanden → fehlenden Kanal-Link ergänzen, ggf. Platzhalter-Flag lösen, Promo-Code anlegen
 * • sonst einen leeren Platzhalter gleicher Plattform/Kategorie übernehmen, sonst neu anlegen
 * • Existiert der Promo-Code schon ohne Eintrag (Eintrag wurde bewusst gelöscht), wird nichts neu angelegt.
 * Es werden nie E-Mails gesetzt.
 */
async function ensureFeaturedCreators(createdBy: string) {
  const all = await db.select().from(creatorLeads);
  let changed = 0;
  for (const f of FEATURED_CREATORS) {
    const existing = all.find((l) => l.name.trim().toLowerCase() === f.name.toLowerCase());
    if (existing) {
      const u: Partial<Lead> = {};
      if (!existing.channelUrl) u.channelUrl = f.channelUrl;
      if (existing.placeholder) u.placeholder = false;
      if (!existing.promoId) {
        const p = await createCreatorPromo("", f.name, true, createdBy);
        if (p) { u.promoId = p.id; u.promoCode = p.code; }
      }
      if (!existing.customBody && u.promoCode) {
        const m = composeMail({ ...existing, ...u } as Lead);
        u.subject = m.subject; u.body = m.body;
      }
      if (Object.keys(u).length) { await db.update(creatorLeads).set({ ...u, updatedAt: new Date() }).where(eq(creatorLeads.id, existing.id)); changed++; }
      continue;
    }
    const [promoTaken] = await db.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.code, suggestPromoCode(f.name))).limit(1);
    if (promoTaken) continue;
    const slot = all.find((l) => l.placeholder && /^Platzhalter/i.test(l.name) && l.platform === f.platform && l.category === f.category && l.status === "ready" && !l.email);
    if (slot) {
      const p = await createCreatorPromo("", f.name, true, createdBy);
      const template = chooseTemplate(f.category, slot.followers);
      const m = composeMail({ name: f.name, promoCode: p?.code || "", template, platform: f.platform });
      await db.update(creatorLeads).set({
        name: f.name, channelUrl: f.channelUrl, placeholder: false, promoId: p?.id ?? null, promoCode: p?.code || "", template,
        subject: m.subject, body: m.body, customBody: false, source: "featured", notes: "", updatedAt: new Date(),
      }).where(eq(creatorLeads.id, slot.id));
      all.splice(all.indexOf(slot), 1, { ...slot, name: f.name, placeholder: false });
    } else {
      const lead = await createLead({ name: f.name, platform: f.platform, category: f.category, channelUrl: f.channelUrl, source: "featured", createdBy });
      all.push(lead);
    }
    changed++;
  }
  return changed;
}

async function seedIfEmpty(createdBy: string) {
  const [r] = rows(await db.execute(sql`SELECT count(*)::int AS n FROM creator_leads`));
  if (Number(r?.n) > 0) return false;
  for (const s of STARTER_LEADS) {
    await createLead({ ...s, source: "seed", createdBy });
  }
  return true;
}

// ---------------------------------------------------------------------------
// Versand (Resend) mit Tageslimit, Abstand, Sperrliste
// ---------------------------------------------------------------------------
async function sendStats() {
  const [r] = rows(await db.execute(sql`
    SELECT count(*) FILTER (WHERE ok AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'))::int AS today,
      max(created_at) FILTER (WHERE ok) AS last
    FROM creator_outreach_log WHERE created_at > now() - interval '2 days'`));
  return { sentToday: Number(r?.today) || 0, lastSentAt: r?.last ? new Date(r.last) : null };
}

async function isSuppressed(email: string) {
  const [s] = await db.select().from(creatorSuppressions).where(eq(creatorSuppressions.email, normEmail(email))).limit(1);
  return Boolean(s);
}

async function resendSend(to: string, subject: string, text: string, unsubscribe: string) {
  const replyTo = adminEmails()[0];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM, to: [to], subject: subject.slice(0, 200), text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "category", value: "creator_outreach" }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.message || data?.error || `Resend ${res.status}`).slice(0, 200));
  return String(data?.id || "");
}

/** Sendet die Erst- oder Follow-up-Mail an einen Lead. Prüft alle Schutzregeln. */
export async function sendLead(leadId: number, kind: "initial" | "followup", opts: { ignoreGap?: boolean; bulk?: boolean } = {}) {
  if (!mailConfigured()) return { ok: false, error: "E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY / MAIL_FROM)." };
  const [l] = await db.select().from(creatorLeads).where(eq(creatorLeads.id, leadId)).limit(1);
  if (!l) return { ok: false, error: "Creator nicht gefunden." };
  if (l.placeholder) return { ok: false, error: "Platzhalter zuerst mit echtem Kanalnamen ausfüllen." };
  if (!EMAIL_OK.test(l.email)) return { ok: false, error: "Keine gültige E-Mail – Kontakt-Extraktor nutzen oder DM kopieren." };
  if (l.status === "optout" || (await isSuppressed(l.email))) {
    await db.update(creatorLeads).set({ status: "optout", scheduledAt: null, updatedAt: new Date() }).where(eq(creatorLeads.id, l.id));
    return { ok: false, error: "Diese Adresse hat sich abgemeldet – kein Versand." };
  }
  if (kind === "initial" && !["ready", "queued", "paused"].includes(l.status)) return { ok: false, error: "Diese Mail wurde bereits gesendet." };
  if (kind === "followup" && (l.status !== "sent" || l.followupSentAt)) return { ok: false, error: "Follow-up nicht möglich (schon gesendet oder bereits geantwortet)." };
  // Massenversand: nie an Creator, die schon einmal angeschrieben wurden (auch wenn der Status später zurückgesetzt wurde)
  if (opts.bulk && (l.sentAt || kind !== "initial")) return { ok: false, error: "Wurde bereits angeschrieben – kein zweiter Versand.", skip: true };
  // Massenversand: nur an zustellbare Adressen (MX-Eintrag) – noch ungeprüfte Adressen werden jetzt geprüft
  if (opts.bulk && !l.emailVerifiedAt) {
    if (!(await hasMx(l.email))) {
      await db.update(creatorLeads).set({ lastError: "Domain ohne MX-Eintrag – E-Mail nicht zustellbar.", updatedAt: new Date() }).where(eq(creatorLeads.id, l.id));
      return { ok: false, error: "Domain ohne MX-Eintrag – E-Mail nicht zustellbar.", skip: true };
    }
    await db.update(creatorLeads).set({ emailVerifiedAt: new Date(), emailSource: l.emailSource || "MX geprüft" }).where(eq(creatorLeads.id, l.id));
  }
  const st = await sendStats();
  const gate = canSendNow({ ...st, gapMs: opts.ignoreGap || opts.bulk ? 0 : OUTREACH_MIN_GAP_MS, cap: opts.bulk ? OUTREACH_BULK_DAILY_CAP : OUTREACH_DAILY_CAP });
  if (!gate.ok) return { ok: false, error: gate.reason, waitMs: gate.waitMs };

  // Doppelversand verhindern: Lead atomar „belegen“
  const lockStatus = kind === "initial" ? ["ready", "queued", "paused"] : ["sent"];
  const [locked] = await db.update(creatorLeads).set({ status: "sending", updatedAt: new Date() })
    .where(and(eq(creatorLeads.id, l.id), inArray(creatorLeads.status, lockStatus))).returning({ id: creatorLeads.id });
  if (!locked) return { ok: false, error: "Wird gerade schon gesendet." };

  const v = mailVars(l);
  const cur = currentMail(l);
  const subject = kind === "initial" ? (cur.subject || composeMail(l).subject) : fillTemplate(FOLLOWUP_TEMPLATE.subject, v);
  const text = (kind === "initial" ? (cur.body || composeMail(l).body) : fillTemplate(FOLLOWUP_TEMPLATE.body, v)) + legalFooter(site(), optoutUrl(l.optoutToken));
  try {
    const id = await resendSend(l.email, subject, text, optoutUrl(l.optoutToken));
    await db.insert(creatorOutreachLog).values({ leadId: l.id, kind, email: l.email, ok: true, resendId: id });
    const now = new Date();
    await db.update(creatorLeads).set(kind === "initial"
      ? { status: "sent", sentAt: now, scheduledAt: null, lastError: "", updatedAt: now }
      : { status: "sent", followupSentAt: now, lastError: "", updatedAt: now }).where(eq(creatorLeads.id, l.id));
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    await db.insert(creatorOutreachLog).values({ leadId: l.id, kind, email: l.email, ok: false, error: msg });
    await db.update(creatorLeads).set({ status: kind === "initial" ? (l.status === "queued" ? "paused" : l.status) : "sent", lastError: msg, scheduledAt: null, updatedAt: new Date() })
      .where(eq(creatorLeads.id, l.id));
    log.warn("creator", "Outreach-Mail fehlgeschlagen", { leadId: l.id, error: msg });
    return { ok: false, error: `Versand fehlgeschlagen: ${msg}` };
  }
}

/** Warteschlange abarbeiten (Job alle 5 Minuten): höchstens eine fällige Mail pro Lauf. */
export async function processOutreachQueue() {
  const [next] = await db.select().from(creatorLeads)
    .where(and(eq(creatorLeads.status, "queued"), sql`${creatorLeads.scheduledAt} <= now()`))
    .orderBy(creatorLeads.scheduledAt).limit(1);
  if (!next) return { sent: 0, waiting: 0 };
  const r = await sendLead(next.id, "initial");
  if (!r.ok && (r as any).waitMs !== undefined) {
    // Limit / Abstand: auf später verschieben statt abzubrechen
    const st = await sendStats();
    const [slot] = staggerSchedule(1, { ...st, now: Date.now() + Math.max(60_000, Number((r as any).waitMs) || 0) });
    await db.update(creatorLeads).set({ status: "queued", scheduledAt: slot, updatedAt: new Date() }).where(and(eq(creatorLeads.id, next.id), eq(creatorLeads.status, "queued")));
  }
  return { sent: r.ok ? 1 : 0, error: r.ok ? "" : r.error };
}

// ---------------------------------------------------------------------------
// Kontakt-Extraktor: öffentliche Seite sicher abrufen
// ---------------------------------------------------------------------------
export async function safeFetchHtml(raw: string, depth = 0, timeoutMs = 8000): Promise<{ html: string; url: string }> {
  const chk = checkFetchUrl(raw);
  if (!chk.ok) throw new Error(chk.reason);
  const u = chk.url;
  if (isPlatformHost(u.hostname)) throw Object.assign(new Error("platform"), { platform: true });
  const addrs = await dnsLookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("Domain nicht gefunden.");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("Interne Adressen sind nicht erlaubt.");
  const res = await fetch(u, {
    redirect: "manual",
    headers: { "User-Agent": "Mozilla/5.0 (compatible; PokeSwipeRadar-ContactCheck/1.0; +https://pokeswipe-radar.de/creator)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.5", "Accept-Language": "de,en;q=0.8" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc || depth >= 3) throw new Error("Zu viele Weiterleitungen.");
    return safeFetchHtml(new URL(loc, u).toString(), depth + 1, timeoutMs);
  }
  if (!res.ok) throw new Error(`Seite antwortet mit ${res.status}.`);
  const type = res.headers.get("content-type") || "";
  if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error("Keine HTML-Seite.");
  // Höchstens 1,5 MB lesen
  const reader = res.body?.getReader();
  let html = "", size = 0;
  const dec = new TextDecoder();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      html += dec.decode(value, { stream: true });
      if (size > 1_500_000) { try { await reader.cancel(); } catch {} break; }
    }
  }
  return { html, url: u.toString() };
}

// ---------------------------------------------------------------------------
// Ausgabe für die Admin-Oberfläche
// ---------------------------------------------------------------------------
function leadView(l: Lead & { redemptions?: number | null; promo_active?: boolean | null }) {
  const mail = composeMail(l);
  const cur = currentMail(l);
  const socials = Array.isArray(l.socials) ? (l.socials as string[]) : [];
  const bioLink = socials.find((s) => { try { return !isPlatformHost(new URL(s).hostname); } catch { return false; } }) || "";
  return {
    id: l.id, name: l.name, category: l.category, categoryLabel: CATEGORY_LABEL[l.category] || l.category, platform: l.platform,
    platformLabel: PLATFORM_LABEL[l.platform] || l.platform, channelUrl: l.channelUrl, followers: l.followers, email: l.email, socials, bioLink,
    emailSource: l.emailSource || "", emailVerifiedAt: l.emailVerifiedAt, emailSearchedAt: l.emailSearchedAt, emailSearchNote: l.emailSearchNote || "",
    tier: tierOf(l.followers), tierLabel: TIER_LABEL[tierOf(l.followers)], score: responseScore(l),
    promoId: l.promoId, promoCode: l.promoCode, promoActive: l.promo_active ?? null, signups: Number(l.redemptions) || 0,
    link: l.promoCode ? creatorLink(site(), l.promoCode) : "", creatorPage: creatorPage(site()), template: l.template, subject: cur.subject, body: cur.body, customBody: l.customBody,
    dm: mail.dm, status: l.status, display: displayStatus(l), placeholder: l.placeholder, source: l.source, notes: l.notes,
    scheduledAt: l.scheduledAt, sentAt: l.sentAt, followupSentAt: l.followupSentAt, repliedAt: l.repliedAt, lastError: l.lastError,
    followupDueAt: l.sentAt ? new Date(new Date(l.sentAt).getTime() + FOLLOWUP_AFTER_DAYS * 86_400_000) : null,
    research: researchLinks(l),
  };
}

async function loadLeads() {
  const list = rows(await db.execute(sql`
    SELECT l.*, p.redemptions, p.active AS promo_active FROM creator_leads l LEFT JOIN promo_codes p ON p.id = l.promo_id
    ORDER BY CASE l.status WHEN 'sending' THEN 0 WHEN 'queued' THEN 1 WHEN 'ready' THEN 2 WHEN 'sent' THEN 3 WHEN 'replied' THEN 4 WHEN 'active' THEN 5 ELSE 6 END, l.placeholder, l.id`));
  // rohe Zeilen → camelCase wie Drizzle
  return list.map((r: any) => leadView({
    id: r.id, name: r.name, category: r.category, platform: r.platform, channelUrl: r.channel_url, followers: r.followers, email: r.email,
    emailSource: r.email_source ?? "", emailVerifiedAt: r.email_verified_at, emailSearchedAt: r.email_searched_at, emailSearchNote: r.email_search_note ?? "",
    socials: r.socials ?? [], promoId: r.promo_id, promoCode: r.promo_code, template: r.template, subject: r.subject, body: r.body, customBody: r.custom_body,
    status: r.status, placeholder: r.placeholder, source: r.source, notes: r.notes, scheduledAt: r.scheduled_at, sentAt: r.sent_at,
    followupSentAt: r.followup_sent_at, repliedAt: r.replied_at, lastError: r.last_error, optoutToken: r.optout_token, createdAt: r.created_at,
    updatedAt: r.updated_at, redemptions: r.redemptions, promo_active: r.promo_active,
  } as any));
}

async function grantCreatorPass(email: string) {
  const e = normEmail(email);
  if (!EMAIL_OK.test(e)) return null;
  const [p] = await db.select().from(profiles).where(sql`lower(${profiles.email}) = ${e}`).limit(1);
  if (!p) return null;
  const forever = new Date("2099-12-31T23:59:59Z");
  await db.update(profiles).set({ creatorAt: p.creatorAt ?? new Date(), bonusPlan: "pro", bonusUntil: forever }).where(eq(profiles.userId, p.userId));
  await notify(p.userId, "🎬 VIP-Creator-Pass aktiv", "Du hast jetzt dauerhaft PokeSwipe Pro und das verifizierte Creator-Badge. Danke, dass du dabei bist!", "/?tab=profile").catch(() => {});
  return p.userId;
}

const ipHash = (c: any) => createHash("sha256").update(`${process.env.SITE_ID || "ps"}|creator|${clientIp(c)}`).digest("hex").slice(0, 32);

// ---------------------------------------------------------------------------
// Routen
// ---------------------------------------------------------------------------
export function registerCreator(app: any, hlp: Hlp) {
  const { auth, adminOnly, body } = hlp;

  // ---------------- Öffentlich: Bewerbung von /creator ----------------
  app.post("/api/creator/apply", async (c: any) => {
    if (!(await rateLimit(`creator-apply:${clientIp(c)}`, 4, 60 * 60_000))) return c.json({ error: "Zu viele Anfragen – bitte später erneut versuchen." }, 429);
    const b = await body(c);
    if (str(b.website, 100)) return c.json({ ok: true }); // Honeypot (Bots)
    const channelName = str(b.channelName, 80);
    const platform = String(b.platform || "");
    const channelUrl = cleanUrl(b.channelUrl);
    const followers = int(b.followers, 0, 100_000_000, 0);
    const email = normEmail(b.email);
    const wish = cleanWishCode(b.wishCode);
    const message = str(b.message, 600);
    if (channelName.length < 2) return c.json({ error: "Bitte gib deinen Kanalnamen an." }, 400);
    if (!(CREATOR_PLATFORMS as readonly string[]).includes(platform)) return c.json({ error: "Bitte eine Plattform wählen." }, 400);
    if (!channelUrl) return c.json({ error: "Bitte einen gültigen Kanal-Link angeben." }, 400);
    if (!EMAIL_OK.test(email)) return c.json({ error: "Bitte eine gültige Kontakt-E-Mail angeben." }, 400);
    if (b.wishCode && !wish) return c.json({ error: "Wunsch-Code: 3–24 Zeichen, nur A–Z, 0–9, - und _." }, 400);
    if (b.consent !== true) return c.json({ error: "Bitte der Kontaktaufnahme zustimmen." }, 400);
    const [dup] = await db.select({ id: creatorApplications.id }).from(creatorApplications)
      .where(and(sql`lower(${creatorApplications.email}) = ${email}`, eq(creatorApplications.status, "new"))).limit(1);
    if (dup) return c.json({ ok: true, duplicate: true, message: "Deine Bewerbung liegt uns schon vor – wir melden uns!" });

    // Wunsch-Code als Entwurf (inaktiv) reservieren
    const promo = await createCreatorPromo(wish || suggestPromoCode(channelName), `Creator-Bewerbung: ${channelName} (Entwurf)`, false, email);
    const [a] = await db.insert(creatorApplications).values({
      channelName, platform, channelUrl, followers, email, wishCode: wish, promoId: promo?.id ?? null, message, ipHash: ipHash(c),
    }).returning();

    // Admin benachrichtigen (E-Mail über Resend + Mitteilung in der App)
    const summary = `${channelName} (${PLATFORM_LABEL[platform]}, ~${followers.toLocaleString("de-DE")} Follower)\n${channelUrl}\nKontakt: ${email}\nCode-Entwurf: ${promo?.code || "–"}${message ? `\n\nNachricht:\n${message}` : ""}`;
    for (const to of adminEmails()) sendMail(to, `🎬 Neue Creator-Bewerbung: ${channelName}`, `${summary}\n\nFreigeben: ${site()}/?tab=admin`).catch(() => {});
    const admins = adminEmails();
    if (admins.length) {
      const list = await db.select({ id: profiles.userId }).from(profiles).where(inArray(sql`lower(${profiles.email})`, admins)).limit(10);
      for (const p of list) notify(p.id, "🎬 Neue Creator-Bewerbung", `${channelName} (${PLATFORM_LABEL[platform]}) – Code-Entwurf ${promo?.code || "–"}`, "/?tab=admin").catch(() => {});
    }
    return c.json({ ok: true, id: a.id, code: promo?.code || "", message: "Danke! Wir prüfen deine Bewerbung und melden uns per E-Mail – meist innerhalb von 48 Stunden." }, 201);
  });

  // ---------------- Öffentlich: Abmelden (Link in jeder Mail, One-Click per POST) ----------------
  const optoutPage = (title: string, text: string, form = "") => `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${h(title)}</title>
    <style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem}main{max-width:28rem;background:#1e293b;border-radius:1rem;padding:1.5rem}button{background:#facc15;border:0;border-radius:.6rem;padding:.7rem 1rem;font-weight:800;cursor:pointer}a{color:#facc15}</style></head>
    <body><main><h1 style="font-size:1.2rem">${h(title)}</h1><p>${h(text)}</p>${form}<p style="font-size:.8rem;margin-top:1.5rem"><a href="/">PokeSwipe Radar</a> · <a href="/impressum">Impressum</a> · <a href="/datenschutz">Datenschutz</a></p></main></body></html>`;
  async function optout(token: string) {
    if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return false;
    const [l] = await db.select().from(creatorLeads).where(eq(creatorLeads.optoutToken, token)).limit(1);
    if (!l) return false;
    await db.update(creatorLeads).set({ status: "optout", scheduledAt: null, updatedAt: new Date() }).where(eq(creatorLeads.id, l.id));
    if (EMAIL_OK.test(l.email)) await db.insert(creatorSuppressions).values({ email: normEmail(l.email) }).onConflictDoNothing();
    return true;
  }
  app.get("/api/creator/optout", (c: any) => {
    const t = String(c.req.query("t") || "");
    c.header("Cache-Control", "no-store");
    return c.html(optoutPage("Keine weiteren Nachrichten?", "Mit einem Klick tragen wir dich aus – du bekommst dann keine Kooperations-Mails mehr von PokeSwipe Radar.",
      `<form method="post" action="/api/creator/optout?t=${encodeURIComponent(t)}"><button type="submit">Jetzt abmelden</button></form>`));
  });
  app.post("/api/creator/optout", async (c: any) => {
    if (!(await rateLimit(`creator-optout:${clientIp(c)}`, 20, 60_000))) return c.text("Bitte kurz warten.", 429);
    const ok = await optout(String(c.req.query("t") || ""));
    c.header("Cache-Control", "no-store");
    return c.html(optoutPage(ok ? "Abgemeldet ✓" : "Link ungültig", ok ? "Du erhältst keine weiteren Nachrichten von uns. Sorry für die Störung!" : "Dieser Abmelde-Link ist ungültig oder abgelaufen. Antworte einfach auf unsere Mail mit „Stopp“."), ok ? 200 : 404);
  });

  // ---------------- Admin: Creator-Finder & Outreach ----------------
  app.get("/api/admin/creators", auth, adminOnly, async (c: any) => {
    const seeded = await seedIfEmpty(c.get("user").email || "");
    await ensureFeaturedCreators(c.get("user").email || "").catch((e) => log.warn("creator", "Feste Creator konnten nicht angelegt werden", { error: String(e?.message || e) }));
    const [leads, st, apps] = await Promise.all([
      loadLeads(),
      sendStats(),
      db.select().from(creatorApplications).orderBy(desc(creatorApplications.createdAt)).limit(60),
    ]);
    const promoIds = apps.map((a) => a.promoId).filter(Boolean) as number[];
    const promos = promoIds.length ? await db.select().from(promoCodes).where(inArray(promoCodes.id, promoIds)) : [];
    const gate = canSendNow(st);
    return c.json({
      seeded, leads,
      applications: apps.map((a) => ({ ...a, promoCode: promos.find((p) => p.id === a.promoId)?.code || "", platformLabel: PLATFORM_LABEL[a.platform] || a.platform })),
      sending: { configured: mailConfigured(), cap: OUTREACH_DAILY_CAP, sentToday: st.sentToday, lastSentAt: st.lastSentAt, canSend: gate.ok, reason: gate.reason, minGapMin: OUTREACH_MIN_GAP_MS / 60_000, senderName: senderName(), bulkCap: OUTREACH_BULK_DAILY_CAP, bulkGapMs: BULK_SEND_GAP_MS },
      templates: TEMPLATE_IDS.map((id) => ({ id, label: TEMPLATES[id].label, subject: TEMPLATES[id].subject, body: TEMPLATES[id].body, dm: TEMPLATES[id].dm })),
      categories: CREATOR_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABEL[id] })),
      platforms: CREATOR_PLATFORMS.map((id) => ({ id, label: PLATFORM_LABEL[id] })),
      followupDays: FOLLOWUP_AFTER_DAYS,
      tiktokSearches: TIKTOK_NICHE_SEARCHES,
    });
  });

  app.post("/api/admin/creators", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const name = str(b.name, 80);
    if (name.length < 2) return c.json({ error: "Bitte einen Kanalnamen angeben." }, 400);
    const category = (CREATOR_CATEGORIES as readonly string[]).includes(b.category) ? b.category : "packopening";
    const platform = (CREATOR_PLATFORMS as readonly string[]).includes(b.platform) ? b.platform : "youtube";
    const email = normEmail(b.email);
    if (email && !EMAIL_OK.test(email)) return c.json({ error: "Ungültige E-Mail." }, 400);
    // TikTok-Schnellfeld: „@handle“ → Profil-Link, Linktree/Bio-Link landet bei den gefundenen Links (für den Extraktor)
    let channelUrl = cleanUrl(b.channelUrl);
    if (!channelUrl && platform === "tiktok") channelUrl = tiktokProfileUrl(String(b.name || ""));
    const bio = cleanUrl(b.bioUrl);
    const lead = await createLead({
      name: name.replace(/^@/, "").slice(0, 80) || name, category, platform, channelUrl, followers: int(b.followers, 0, 1e9, 0), email, notes: str(b.notes, 1000),
      socials: bio ? [bio] : [], source: b.quick === true ? "tiktok-quick" : "manual", createdBy: c.get("user").email || "",
    });
    return c.json({ lead: (await loadLeads()).find((l) => l.id === lead.id) }, 201);
  });

  app.patch("/api/admin/creators/:id", auth, adminOnly, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const [l] = await db.select().from(creatorLeads).where(eq(creatorLeads.id, id)).limit(1);
    if (!l) return c.json({ error: "Nicht gefunden" }, 404);
    const b = await body(c);
    const u: Partial<Lead> = {};
    if (b.name !== undefined) { const n = str(b.name, 80); if (n.length < 2) return c.json({ error: "Name zu kurz" }, 400); u.name = n; if (l.placeholder && !/^Platzhalter/i.test(n)) u.placeholder = false; }
    if (b.category !== undefined && (CREATOR_CATEGORIES as readonly string[]).includes(b.category)) u.category = b.category;
    if (b.platform !== undefined && (CREATOR_PLATFORMS as readonly string[]).includes(b.platform)) u.platform = b.platform;
    if (b.channelUrl !== undefined) u.channelUrl = cleanUrl(b.channelUrl);
    if (b.followers !== undefined) u.followers = int(b.followers, 0, 1e9, 0);
    if (b.email !== undefined) {
      const e = normEmail(b.email);
      if (e && !EMAIL_OK.test(e)) return c.json({ error: "Ungültige E-Mail." }, 400);
      if (e !== l.email) {
        u.email = e;
        const mx = e ? await hasMx(e) : false;
        u.emailSource = e ? (mx ? "Manuell eingetragen · MX geprüft" : "Manuell eingetragen · kein MX-Eintrag gefunden") : "";
        u.emailVerifiedAt = mx ? new Date() : null;
      }
    }
    if (b.notes !== undefined) u.notes = str(b.notes, 1000);
    if (b.template !== undefined && (TEMPLATE_IDS as string[]).includes(b.template)) u.template = b.template;
    if (b.status !== undefined) {
      if (!(LEAD_STATUSES as string[]).includes(b.status)) return c.json({ error: "Ungültiger Status" }, 400);
      u.status = b.status;
      if (b.status === "replied") u.repliedAt = l.repliedAt ?? new Date();
      if (b.status !== "queued") u.scheduledAt = null;
      if (b.status === "optout" && EMAIL_OK.test(l.email)) await db.insert(creatorSuppressions).values({ email: normEmail(l.email) }).onConflictDoNothing();
    }
    if (b.subject !== undefined || b.body !== undefined) {
      if (b.subject !== undefined) u.subject = str(b.subject, 200);
      if (b.body !== undefined) u.body = String(b.body ?? "").slice(0, 6000);
      u.customBody = true;
    }
    if (b.resetBody === true) u.customBody = false;
    // Persönlichen Promo-Code anlegen, sobald aus einem Platzhalter ein echter Creator wird
    const merged = { ...l, ...u };
    if (!merged.placeholder && !merged.promoId) {
      const p = await createCreatorPromo("", merged.name, true, c.get("user").email || "");
      if (p) { u.promoId = p.id; u.promoCode = p.code; merged.promoCode = p.code; }
    }
    if (!merged.customBody && (u.name || u.template || u.promoCode || u.category || b.resetBody)) {
      if (b.template === undefined && (u.category || u.followers !== undefined)) { u.template = chooseTemplate(merged.category, merged.followers); merged.template = u.template; }
      const m = composeMail(merged);
      u.subject = m.subject; u.body = m.body;
    }
    if (Object.keys(u).length) await db.update(creatorLeads).set({ ...u, updatedAt: new Date() }).where(eq(creatorLeads.id, id));
    return c.json({ lead: (await loadLeads()).find((x) => x.id === id) });
  });

  app.delete("/api/admin/creators/:id", auth, adminOnly, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    await db.delete(creatorLeads).where(eq(creatorLeads.id, id));
    return c.json({ ok: true });
  });

  // „Freigeben & senden“ – sofort (mit Tageslimit + Abstand)
  app.post("/api/admin/creators/:id/send", auth, adminOnly, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const b = await body(c);
    const bulk = b.bulk === true && b.kind !== "followup";
    const r = await sendLead(id, b.kind === "followup" ? "followup" : "initial", { bulk });
    // Massenversand: schlanke Antwort (die Liste lädt der Browser einmal am Ende neu)
    if (bulk) return r.ok ? c.json({ ok: true, id }) : c.json({ error: r.error, skip: Boolean((r as any).skip), stop: (r as any).waitMs !== undefined }, 409);
    return r.ok ? c.json({ ok: true, lead: (await loadLeads()).find((x) => x.id === id) }) : c.json({ error: r.error }, 409);
  });

  // „Ausgewählte nacheinander senden“ – gestaffelte Warteschlange (Job creator-outreach, alle 5 Min.)
  app.post("/api/admin/creators/queue", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map((x: unknown) => int(x, 1, 2 ** 31 - 1, 0)).filter(Boolean).slice(0, 60);
    if (!ids.length) return c.json({ error: "Bitte Creator auswählen." }, 400);
    if (!mailConfigured()) return c.json({ error: "E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY / MAIL_FROM)." }, 409);
    const list = await db.select().from(creatorLeads).where(and(inArray(creatorLeads.id, ids), inArray(creatorLeads.status, ["ready", "paused"]), eq(creatorLeads.placeholder, false)));
    const ok = list.filter((l) => EMAIL_OK.test(l.email));
    const suppressed = ok.length ? await db.select().from(creatorSuppressions).where(inArray(creatorSuppressions.email, ok.map((l) => normEmail(l.email)))) : [];
    const sendable = ok.filter((l) => !suppressed.some((s) => s.email === normEmail(l.email)));
    // Bereits wartende Mails belegen ihre Plätze: neue Slots kommen dahinter (Tageslimit gilt für beide zusammen)
    const [q] = rows(await db.execute(sql`
      SELECT max(scheduled_at) AS last,
        count(*) FILTER (WHERE scheduled_at < (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin') + interval '1 day')::int AS today
      FROM creator_leads WHERE status = 'queued'`));
    const st = await sendStats();
    const lastQueued = q?.last ? new Date(q.last).getTime() : 0;
    const lastAny = Math.max(st.lastSentAt?.getTime() ?? 0, lastQueued ? lastQueued + 6 * 60_000 - OUTREACH_MIN_GAP_MS : 0);
    const slots = staggerSchedule(sendable.length, { now: Math.max(Date.now(), lastQueued ? lastQueued + 6 * 60_000 : 0), sentToday: st.sentToday + (Number(q?.today) || 0), lastSentAt: lastAny ? new Date(lastAny) : null });
    for (let i = 0; i < sendable.length; i++) {
      await db.update(creatorLeads).set({ status: "queued", scheduledAt: slots[i], updatedAt: new Date() }).where(eq(creatorLeads.id, sendable[i].id));
    }
    return c.json({ queued: sendable.length, skipped: ids.length - sendable.length, leads: await loadLeads() });
  });

  // Freigabe einer Bewerbung: Code aktivieren, Creator anlegen, VIP-Pass vergeben (falls Konto vorhanden), Bestätigung senden
  app.post("/api/admin/creator-applications/:id", auth, adminOnly, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const b = await body(c);
    const [a] = await db.select().from(creatorApplications).where(eq(creatorApplications.id, id)).limit(1);
    if (!a) return c.json({ error: "Nicht gefunden" }, 404);
    if (b.action === "reject") {
      await db.update(creatorApplications).set({ status: "rejected", decidedAt: new Date() }).where(eq(creatorApplications.id, id));
      return c.json({ ok: true });
    }
    if (b.action !== "approve") return c.json({ error: "Unbekannte Aktion" }, 400);
    let code = "";
    if (a.promoId) {
      const [p] = await db.update(promoCodes).set({ active: true, label: `Creator: ${a.channelName}`.slice(0, 80), days: CREATOR_PROMO_DAYS }).where(eq(promoCodes.id, a.promoId)).returning();
      code = p?.code || "";
    }
    if (!code) {
      const p = await createCreatorPromo(a.wishCode, a.channelName, true, c.get("user").email || "");
      code = p?.code || "";
      if (p) await db.update(creatorApplications).set({ promoId: p.id }).where(eq(creatorApplications.id, id));
    }
    const [promo] = code ? await db.select().from(promoCodes).where(eq(promoCodes.code, code)).limit(1) : [];
    let leadId = a.leadId;
    if (!leadId) {
      const lead = await createLead({
        name: a.channelName, category: a.platform === "discord" ? "community" : tierOf(a.followers) === "micro" ? "micro" : "packopening",
        platform: a.platform, channelUrl: a.channelUrl, followers: a.followers, email: a.email, source: "application", status: "active",
        promoId: promo?.id ?? null, promoCode: code, createdBy: c.get("user").email || "", notes: a.message,
      });
      leadId = lead.id;
    }
    const userId = await grantCreatorPass(a.email);
    await db.update(creatorApplications).set({ status: "approved", decidedAt: new Date(), leadId }).where(eq(creatorApplications.id, id));
    // Bestätigung an den Creator (transaktional – er hat sich selbst beworben)
    const link = code ? creatorLink(site(), code) : `${site()}/creator`;
    const mailed = await sendMail(a.email, `🎬 Willkommen im PokeSwipe-Creator-Programm, ${a.channelName}!`,
      `Hey ${a.channelName},\n\ndeine Bewerbung ist freigegeben – danke, dass du dabei bist!\n\n• Dein Community-Code: ${code}\n  Jeder Zuschauer testet damit 30 Tage PokeSwipe Pro kostenlos.\n• Dein persönlicher Link: ${link}\n• VIP-Creator-Pass (dauerhaft Pro + Creator-Badge): ${userId ? "ist in deinem Konto bereits aktiv." : `wird aktiviert, sobald du dich mit ${a.email} unter ${site()} registrierst und uns kurz antwortest.`}\n\nBei Fragen einfach auf diese Mail antworten.\n\nViele Grüße\nDein PokeSwipe-Radar-Team\n\n—\nPokeSwipe Radar · ${site()} · Impressum: ${site()}/impressum`);
    return c.json({ ok: true, code, leadId, passGranted: Boolean(userId), mailed });
  });

  // VIP-Creator-Pass manuell an ein Konto (per E-Mail) vergeben – z. B. nach positiver Antwort
  app.post("/api/admin/creators/:id/grant-pass", auth, adminOnly, async (c: any) => {
    const id = int(c.req.param("id"), 1, 2 ** 31 - 1, 0);
    const b = await body(c);
    const [l] = await db.select().from(creatorLeads).where(eq(creatorLeads.id, id)).limit(1);
    if (!l) return c.json({ error: "Nicht gefunden" }, 404);
    const userId = await grantCreatorPass(normEmail(b.email) || l.email);
    if (!userId) return c.json({ error: "Kein Konto mit dieser E-Mail gefunden – der Creator muss sich zuerst registrieren." }, 404);
    await db.update(creatorLeads).set({ status: "active", updatedAt: new Date() }).where(eq(creatorLeads.id, id));
    return c.json({ ok: true });
  });

  // ---------------- Schnell-Import: „Name - email@domain.de“ oder reine E-Mail-Listen ----------------
  app.post("/api/admin/creators/import", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const text = String(b.text ?? "").slice(0, 60_000);
    const { entries, invalid, truncated } = parseCreatorImport(text, 200);
    if (!entries.length) return c.json({ error: "Keine E-Mail-Adressen erkannt. Format: „Name - email@domain.de“ (eine pro Zeile) oder einfach eine Liste von Adressen." }, 400);
    const category = (CREATOR_CATEGORIES as readonly string[]).includes(b.category) ? b.category : "packopening";
    const platform = (CREATOR_PLATFORMS as readonly string[]).includes(b.platform) ? b.platform : "youtube";
    const existing = await db.select({ id: creatorLeads.id, name: creatorLeads.name, email: creatorLeads.email }).from(creatorLeads);
    const known = new Set(existing.map((l) => normEmail(l.email)).filter(Boolean));
    const supp = new Set((await db.select({ e: creatorSuppressions.email }).from(creatorSuppressions)).map((r) => r.e));
    const created: { id: number; name: string; email: string; promoCode: string }[] = [];
    const skipped: { email: string; reason: string }[] = invalid.slice(0, 50).map((e) => ({ email: e, reason: "Keine gültige Adresse" }));
    const by = c.get("user").email || "";
    // MX-Prüfungen parallel (je Domain zwischengespeichert)
    const mx = await Promise.all(entries.map((e) => hasMx(e.email)));
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (known.has(e.email)) { skipped.push({ email: e.email, reason: "Schon im Creator-Finder" }); continue; }
      if (supp.has(e.email)) { skipped.push({ email: e.email, reason: "Abgemeldet (Sperrliste)" }); continue; }
      if (!mx[i]) { skipped.push({ email: e.email, reason: "Domain ohne MX-Eintrag – nicht zustellbar" }); continue; }
      // Gleicher Name ohne E-Mail vorhanden (z. B. fester Creator) → E-Mail dort ergänzen statt doppelt anlegen
      const same = existing.find((l) => !l.email && l.name.trim().toLowerCase() === e.name.trim().toLowerCase());
      if (same && !e.derived) {
        const [u] = await db.update(creatorLeads).set({ email: e.email, emailSource: "Eigene Liste · MX geprüft", emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(creatorLeads.id, same.id), eq(creatorLeads.email, ""))).returning();
        if (u) { known.add(e.email); same.email = e.email; created.push({ id: u.id, name: u.name, email: e.email, promoCode: u.promoCode }); continue; }
      }
      const lead = await createLead({ name: e.name, category, platform, email: e.email, source: "import", createdBy: by, emailSource: "Eigene Liste · MX geprüft", emailVerified: true });
      known.add(e.email);
      created.push({ id: lead.id, name: lead.name, email: e.email, promoCode: lead.promoCode });
    }
    return c.json({ created, skipped, truncated, leads: await loadLeads() }, created.length ? 201 : 200);
  });

  // ---------------- Kontakt- & Impressums-Extraktor ----------------
  app.post("/api/admin/extract-creator-contact", auth, adminOnly, async (c: any) => {
    if (!(await rateLimit(`creator-extract:${c.get("user").id}`, 30, 60_000))) return c.json({ error: "Bitte kurz warten." }, 429);
    const b = await body(c);
    const raw = str(b.url, 500);
    const url = /^https?:\/\//i.test(raw) ? raw : raw ? `https://${raw}` : "";
    const chk = checkFetchUrl(url);
    if (!chk.ok) return c.json({ error: chk.reason }, 400);
    const leadId = int(b.leadId, 0, 2 ** 31 - 1, 0);
    if (isPlatformHost(chk.url.hostname)) {
      const about = researchLinks({ name: "", platform: "youtube", channelUrl: chk.url.toString() }).youtubeAbout;
      return c.json({
        platform: true, emails: [], socials: [chk.url.toString()], pages: [],
        hint: /youtube/i.test(chk.url.hostname)
          ? "YouTube, TikTok & Instagram rufen wir bewusst nicht automatisch ab (Nutzungsbedingungen). Öffne die Kanalinfo und kopiere die geschäftliche E-Mail – oder gib hier den Linktree/Beacons-/Website-Link aus der Bio ein."
          : "Diese Plattform rufen wir bewusst nicht automatisch ab (Nutzungsbedingungen). Gib den Linktree-, Beacons- oder Website-Link aus der Bio ein.",
        open: /youtube/i.test(chk.url.hostname) ? about : chk.url.toString(),
      });
    }
    const pages: string[] = [];
    let emails: string[] = [], socials: string[] = [];
    try {
      const first = await safeFetchHtml(chk.url.toString());
      pages.push(first.url);
      let r = extractContacts(first.html, first.url);
      emails = r.emails; socials = r.socials;
      if (!emails.length && r.imprint && r.imprint !== first.url) {
        try {
          const second = await safeFetchHtml(r.imprint);
          pages.push(second.url);
          r = extractContacts(second.html, second.url);
          emails = r.emails; socials = [...new Set([...socials, ...r.socials])];
        } catch {}
      }
    } catch (e: any) {
      return c.json({ error: e?.platform ? "Plattform-Seite – bitte manuell öffnen." : `Seite nicht abrufbar: ${String(e?.message || e).slice(0, 120)}` }, 422);
    }
    let updated = false;
    if (leadId) {
      const [l] = await db.select().from(creatorLeads).where(eq(creatorLeads.id, leadId)).limit(1);
      if (l) {
        // Der eingegebene Bio-Link wird mitgespeichert, damit er beim nächsten Mal vorausgefüllt ist
        const mergedSocials = [...new Set([chk.url.toString(), ...(Array.isArray(l.socials) ? (l.socials as string[]) : []), ...socials])].slice(0, 16);
        updated = !l.email && Boolean(emails[0]);
        const page = pages[pages.length - 1] || chk.url.toString();
        let src = "";
        if (updated) {
          let host = "", path = "";
          try { const pu = new URL(page); host = pu.hostname.replace(/^www\./, ""); path = pu.pathname; } catch {}
          const mx = await hasMx(emails[0]);
          src = `${isLinkHub(host) ? `Aus ${linkHubLabel(host)}` : /impressum|imprint/i.test(path) ? "Aus Impressum" : "Aus Website"} · ${host}${mx ? " · MX geprüft" : " · kein MX-Eintrag"}`;
          await db.update(creatorLeads).set({ email: emails[0], emailSource: src, emailVerifiedAt: mx ? new Date() : null, socials: mergedSocials, updatedAt: new Date() }).where(eq(creatorLeads.id, leadId));
        } else {
          await db.update(creatorLeads).set({ socials: mergedSocials, updatedAt: new Date() }).where(eq(creatorLeads.id, leadId));
        }
      }
    }
    return c.json({ emails, socials, pages, updated, hint: emails.length ? "" : "Keine öffentliche E-Mail gefunden – Impressum/Kontaktseite direkt eingeben oder DM nutzen." });
  });
}
