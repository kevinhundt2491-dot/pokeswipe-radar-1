// Auto-Finder für öffentliche Geschäfts-E-Mails von Creatorn (genutzt von netlify/functions/auto-find-creator-emails.mts).
// Ablauf je Creator ohne E-Mail:
//   1. Eigene Links (Kanal-Link, Bio-/Linktree-/Beacons-Links, Website) abrufen – inkl. /impressum, /kontakt, /imprint und mailto:
//   2. Gezielte Web-Suche (Gemini + Google-Suche über das Netlify AI Gateway) liefert NUR Fundstellen-URLs;
//      diese Seiten werden selbst abgerufen – E-Mails aus der KI-Antwort selbst werden nie übernommen.
//   3. Jede Adresse muss wörtlich auf der abgerufenen Seite stehen, zum Creator passen und einen MX-Eintrag haben.
// YouTube/TikTok/Instagram & Co. werden bewusst nicht abgerufen (Nutzungsbedingungen).
import { resolveMx } from "node:dns/promises";
import { GoogleGenAI } from "@google/genai";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, creatorLeads, creatorSuppressions } from "../db/index.ts";
import {
  extractContacts, extractExternalLinks, extractUrlsFromText, imprintCandidates, isLinkHub, isPlatformHost, isSearchSkipHost,
  checkFetchUrl, pageMentions, rankEmailFinds, emailSourceLabel, emailSearchQueries, type EmailFind,
} from "./creator-logic.ts";
import { safeFetchHtml } from "./creator.ts";
import { log } from "./log.ts";

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SEARCH_MODEL = "gemini-3-flash-preview";

// ---------------------------------------------------------------------------
// MX-Prüfung (DNS): nimmt die Domain überhaupt E-Mails an?
// ---------------------------------------------------------------------------
const mxCache = new Map<string, { ok: boolean; at: number }>();
export async function hasMx(email: string): Promise<boolean> {
  const domain = String(email).split("@")[1]?.toLowerCase().replace(/\.$/, "");
  if (!domain || !domain.includes(".")) return false;
  const hit = mxCache.get(domain);
  if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.ok;
  let ok = false;
  try {
    const mx = await resolveMx(domain);
    // „Null MX“ (RFC 7505: Priorität 0, Ziel „.“) bedeutet ausdrücklich: keine E-Mails
    ok = mx.some((r) => r.exchange && r.exchange !== "." && r.exchange.length > 1);
  } catch { ok = false; }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}

// ---------------------------------------------------------------------------
// Web-Suche: nur Fundstellen-URLs
// ---------------------------------------------------------------------------
/** Folgt einer Weiterleitung (z. B. Google-Grounding-Link) und liefert das Ziel – ohne die Zielseite zu laden. */
async function resolveRedirect(raw: string): Promise<string> {
  let cur = raw;
  for (let i = 0; i < 3; i++) {
    const chk = checkFetchUrl(cur);
    if (!chk.ok) return "";
    if (!/(^|\.)(vertexaisearch\.cloud\.google\.com|google\.com)$/i.test(chk.url.hostname)) return chk.url.toString();
    try {
      const res = await fetch(chk.url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      const loc = res.headers.get("location");
      try { await res.body?.cancel(); } catch {}
      if (!loc) return "";
      cur = new URL(loc, chk.url).toString();
    } catch { return ""; }
  }
  return "";
}

async function webSearchUrls(name: string): Promise<string[]> {
  const [q1, q2] = emailSearchQueries(name);
  const prompt = `Suche im Web nach dem offiziellen Impressum bzw. der Kontaktseite des deutschen Pokémon-TCG-Content-Creators „${name}“.
Nutze diese Suchanfragen: ${q1} und ${q2}
Antworte NUR mit einer Liste der URLs (eine pro Zeile) der Seiten, auf denen das Impressum oder die geschäftliche Kontaktadresse von „${name}“ steht – bevorzugt die eigene Website, Linktree oder Beacons. Keine E-Mail-Adressen nennen, nichts erfinden. Wenn du nichts findest, antworte mit „KEINE“.`;
  try {
    const ai = new GoogleGenAI({});
    const r: any = await ai.models.generateContent({ model: SEARCH_MODEL, contents: prompt, config: { tools: [{ googleSearch: {} }], temperature: 0 } });
    const chunks: string[] = (r?.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map((c: any) => String(c?.web?.uri || "")).filter(Boolean);
    const fromText = extractUrlsFromText(String(r?.text || ""));
    const resolved = await Promise.all([...new Set([...chunks.slice(0, 8)])].map((u) => resolveRedirect(u)));
    const all = [...new Set([...resolved, ...fromText].filter(Boolean))];
    return all.filter((u) => { try { return !isSearchSkipHost(new URL(u).hostname); } catch { return false; } }).slice(0, 6);
  } catch (e: any) {
    log.warn("creator", "Web-Suche für E-Mail-Finder fehlgeschlagen", { error: String(e?.message || e).slice(0, 200) });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Suche für einen Creator
// ---------------------------------------------------------------------------
type Lead = typeof creatorLeads.$inferSelect;
export type FindResult = { id: number; name: string; email: string; source: string; note: string; checkedPages: number };

export async function findEmailForLead(l: Lead, opts: { deadline: number; webSearch?: boolean }): Promise<FindResult> {
  const finds: EmailFind[] = [];
  const visited = new Set<string>();
  const left = () => opts.deadline - Date.now();
  const suppressed = new Set((await db.select({ e: creatorSuppressions.email }).from(creatorSuppressions)).map((r) => r.e));

  async function visit(url: string, viaSearch: boolean, follow: boolean) {
    if (visited.has(url) || visited.size >= 14 || left() < 2500) return;
    let host = "";
    try { host = new URL(url).hostname; } catch { return; }
    if (isPlatformHost(host)) return;
    visited.add(url);
    let page: { html: string; url: string };
    try { page = await safeFetchHtml(url, 0, Math.min(6000, Math.max(1500, left() - 1000))); } catch { return; }
    const r = extractContacts(page.html, page.url);
    const mentions = pageMentions(page.html, l.name);
    r.emails.forEach((email, i) => finds.push({ email, pageUrl: page.url, prio: Math.max(1, 3 - i), viaSearch, mentions }));
    if (!follow) return;
    // Impressum-Link der Seite + bei Link-Hubs die verlinkte eigene Website (inkl. deren Impressum)
    if (r.imprint && !r.emails.length) await visit(r.imprint, viaSearch, false);
    if (isLinkHub(host) && !r.emails.length) {
      for (const ext of extractExternalLinks(page.html, page.url).slice(0, 2)) {
        for (const cand of imprintCandidates(ext)) { if (finds.length) break; await visit(cand, viaSearch, cand === ext); }
      }
    }
  }

  // 1) Eigene Links
  const socials = Array.isArray(l.socials) ? (l.socials as string[]) : [];
  const own = [l.channelUrl, ...socials].filter(Boolean).filter((u) => { try { return !isPlatformHost(new URL(u).hostname); } catch { return false; } });
  for (const u of [...new Set(own)].slice(0, 4)) {
    const cands = imprintCandidates(u);
    for (const c of cands) {
      if (finds.length) break;
      await visit(c, false, c === cands[0]);
    }
  }

  // 2) Web-Suche (nur wenn noch nichts gefunden und Zeit übrig)
  let searched = false;
  if (!finds.length && opts.webSearch !== false && left() > 6000 && !l.placeholder) {
    searched = true;
    const urls = await webSearchUrls(l.name);
    for (const u of urls) {
      if (rankEmailFinds(finds, l.name).length) break;
      await visit(u, true, true);
    }
  }

  // 3) Plausibilität + MX
  const ranked = rankEmailFinds(finds, l.name).filter((f) => !suppressed.has(f.email));
  for (const f of ranked.slice(0, 5)) {
    if (await hasMx(f.email)) {
      return { id: l.id, name: l.name, email: f.email, source: emailSourceLabel(f.pageUrl, f.viaSearch), note: "", checkedPages: visited.size };
    }
  }
  const note = ranked.length ? "Gefundene Adresse(n) ohne gültigen MX-Eintrag – nicht übernommen."
    : finds.length ? "Nur Adressen ohne klaren Bezug zum Creator gefunden – nicht übernommen."
    : !own.length && !searched ? "Keine eigenen Links (Linktree/Website) hinterlegt."
    : "Keine öffentliche E-Mail gefunden (Impressum/Linktree/Web-Suche).";
  return { id: l.id, name: l.name, email: "", source: "", note, checkedPages: visited.size };
}

// ---------------------------------------------------------------------------
// Ein Durchlauf (eine Funktions-Anfrage): ein paar Creator parallel, bis das Zeitbudget aufgebraucht ist.
// `since` = Startzeit des Gesamtlaufs: Creator, die in diesem Lauf schon geprüft wurden, werden übersprungen.
// ---------------------------------------------------------------------------
const openLeads = (since: Date) => and(
  eq(creatorLeads.email, ""), eq(creatorLeads.placeholder, false),
  sql`${creatorLeads.status} IN ('ready', 'paused')`,
  or(isNull(creatorLeads.emailSearchedAt), lt(creatorLeads.emailSearchedAt, since)),
);

export async function runAutoFindBatch(o: { since: Date; budgetMs?: number; parallel?: number; webSearch?: boolean }) {
  const deadline = Date.now() + (o.budgetMs ?? 20_000);
  const batch = await db.select().from(creatorLeads).where(openLeads(o.since)).orderBy(creatorLeads.id).limit(o.parallel ?? 3);
  const results = await Promise.all(batch.map(async (l) => {
    let r: FindResult;
    try { r = await findEmailForLead(l, { deadline, webSearch: o.webSearch }); }
    catch (e: any) { r = { id: l.id, name: l.name, email: "", source: "", note: `Fehler: ${String(e?.message || e).slice(0, 120)}`, checkedPages: 0 }; }
    const now = new Date();
    if (r.email && EMAIL_OK.test(r.email)) {
      // Nur übernehmen, wenn das Feld inzwischen nicht manuell befüllt wurde
      const [u] = await db.update(creatorLeads).set({ email: r.email, emailSource: r.source, emailVerifiedAt: now, emailSearchedAt: now, emailSearchNote: "", lastError: "", updatedAt: now })
        .where(and(eq(creatorLeads.id, l.id), eq(creatorLeads.email, ""))).returning({ id: creatorLeads.id });
      if (!u) r = { ...r, email: "", note: "Inzwischen manuell befüllt – nicht überschrieben." };
    } else {
      await db.update(creatorLeads).set({ emailSearchedAt: now, emailSearchNote: r.note.slice(0, 200), updatedAt: now }).where(eq(creatorLeads.id, l.id));
    }
    return r;
  }));
  const [rest] = await db.select({ n: sql<number>`count(*)::int` }).from(creatorLeads).where(openLeads(o.since));
  return { processed: results.length, found: results.filter((r) => r.email).length, remaining: Number(rest?.n) || 0, results };
}
