// Creator-Programm (Outreach, Kontakt-Extraktor, Versand-Regeln) und Live-Online-Radar (Präsenz, Binder-Tausch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  tierOf, responseScore, suggestPromoCode, cleanWishCode, chooseTemplate, fillTemplate, TEMPLATES, TEMPLATE_IDS, FOLLOWUP_TEMPLATE,
  creatorLink, legalFooter, displayStatus, canSendNow, staggerSchedule, berlinDayOf, checkFetchUrl, isPrivateIp, isPlatformHost,
  extractContacts, researchLinks, STARTER_LEADS, OUTREACH_DAILY_CAP, OUTREACH_MIN_GAP_MS,
} from "../server/creator-logic.ts";
import { PROMO_RE } from "../server/referral-logic.ts";
import { presenceBadges } from "../server/presence.ts";

const day = 86_400_000;

test("Scoring: Micro-Creator haben die höchste Antwort-Chance", () => {
  assert.equal(tierOf(0), "unknown");
  assert.equal(tierOf(5_000), "micro");
  assert.equal(tierOf(40_000), "mid");
  assert.equal(tierOf(250_000), "top");
  const micro = responseScore({ followers: 5_000, category: "micro" });
  const mid = responseScore({ followers: 40_000, category: "packopening" });
  const top = responseScore({ followers: 400_000, category: "packopening" });
  assert.ok(micro > mid && mid > top, `${micro} > ${mid} > ${top}`);
  assert.ok(responseScore({ followers: 5_000, category: "micro", email: "a@b.de" }) > micro);
});

test("Promo-Code-Vorschlag: DARIO30, Umlaute, ‚The‘ entfernt, immer gültig", () => {
  assert.equal(suggestPromoCode("Dario"), "DARIO30");
  assert.equal(suggestPromoCode("The Zero of Time"), "ZEROOFTIME30");
  assert.equal(suggestPromoCode("Kartenhöhle Köln"), "KARTENHOEHLEKOELN30");
  assert.equal(suggestPromoCode("🔥"), "CREATOR30");
  for (const s of STARTER_LEADS) assert.match(suggestPromoCode(s.name), PROMO_RE);
  assert.equal(cleanWishCode(" dein name30 "), "DEINNAME30");
  assert.equal(cleanWishCode("ab"), "");
});

test("Starter-Liste: Dario, The Zero of Time und Platzhalter-Slots ohne geratene Kontaktdaten", () => {
  const names = STARTER_LEADS.map((s) => s.name);
  assert.ok(names.includes("Dario") && names.includes("The Zero of Time"));
  assert.ok(STARTER_LEADS.filter((s) => s.placeholder).length >= 4);
  assert.ok(STARTER_LEADS.some((s) => s.category === "flohmarkt") && STARTER_LEADS.some((s) => s.category === "community"));
  assert.ok(!JSON.stringify(STARTER_LEADS).includes("@"), "keine E-Mails/Handles erfunden");
});

test("Vorlagen A–D: Platzhalter werden ersetzt, passende Vorlage je Kategorie", () => {
  assert.deepEqual(TEMPLATE_IDS, ["A", "B", "C", "D"]);
  for (const id of TEMPLATE_IDS) {
    const t = TEMPLATES[id];
    for (const part of [t.subject + t.body, t.dm]) assert.ok(part.includes("[Kanalname]"), `${id} ohne [Kanalname]`);
    assert.ok(t.body.includes("[PromoCode]") && t.body.includes("[CreatorLink]"), `${id} ohne Code/Link`);
    const out = fillTemplate(t.body, { name: "Dario", code: "DARIO30", link: "https://x/?promo=DARIO30" });
    assert.ok(!/\[(Kanalname|PromoCode|CreatorLink|Absender|Signatur)\]/.test(out), `${id}: Platzhalter übrig`);
    assert.ok(out.includes("DARIO30") && out.includes("Dario"));
  }
  assert.ok(fillTemplate(TEMPLATES.A.body, { name: "X", code: "X30", link: "l", sender: "Mia" }).includes("Mia\nPokeSwipe Radar"));
  assert.ok(!fillTemplate(FOLLOWUP_TEMPLATE.body, { name: "X", code: "X30", link: "l" }).includes("["));
  assert.equal(chooseTemplate("community", 50_000), "D");
  assert.equal(chooseTemplate("flohmarkt", 500_000), "B");
  assert.equal(chooseTemplate("packopening", 4_000), "C");
  assert.equal(chooseTemplate("packopening", 60_000), "A");
  assert.equal(creatorLink("https://pokeswipe-radar.de/", "DARIO30"), "https://pokeswipe-radar.de/?promo=DARIO30&utm_source=creator&utm_campaign=dario30");
  const foot = legalFooter("https://pokeswipe-radar.de", "https://pokeswipe-radar.de/api/creator/optout?t=abc");
  assert.ok(foot.includes("/impressum") && foot.includes("optout"));
});

test("Status: Follow-up fällig nach 4 Tagen ohne Antwort, ‚ohne E-Mail‘ für DM-Creator", () => {
  const now = Date.parse("2026-11-20T10:00:00Z");
  assert.equal(displayStatus({ status: "sent", email: "a@b.de", sentAt: new Date(now - 3 * day) }, now).key, "sent");
  assert.equal(displayStatus({ status: "sent", email: "a@b.de", sentAt: new Date(now - 4 * day) }, now).key, "followup");
  assert.equal(displayStatus({ status: "sent", email: "a@b.de", sentAt: new Date(now - 9 * day), followupSentAt: new Date(now - day) }, now).key, "sent");
  assert.equal(displayStatus({ status: "ready", email: "", sentAt: null }, now).key, "no_email");
  assert.equal(displayStatus({ status: "replied", email: "a@b.de", sentAt: new Date(now - 9 * day) }, now).label, "Antwort erhalten");
});

test("Versand-Schutz: max. 15 Mails pro Tag und Mindestabstand", () => {
  const now = Date.now();
  assert.equal(canSendNow({ sentToday: 0, lastSentAt: null, now }).ok, true);
  assert.equal(canSendNow({ sentToday: OUTREACH_DAILY_CAP, lastSentAt: null, now }).ok, false);
  const gap = canSendNow({ sentToday: 2, lastSentAt: new Date(now - 60_000), now });
  assert.equal(gap.ok, false);
  assert.ok(gap.waitMs > 0 && gap.waitMs <= OUTREACH_MIN_GAP_MS);
  assert.equal(canSendNow({ sentToday: 2, lastSentAt: new Date(now - OUTREACH_MIN_GAP_MS - 1), now }).ok, true);
});

test("Warteschlange: gestaffelt, Tageslimit, Rest am nächsten Morgen", () => {
  const now = Date.parse("2026-11-18T10:00:00Z"); // 11:00 Berlin
  const slots = staggerSchedule(20, { now, sentToday: 5 });
  assert.equal(slots.length, 20);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i].getTime() > slots[i - 1].getTime());
  const today = slots.filter((s) => berlinDayOf(s.getTime()) === berlinDayOf(now)).length;
  assert.equal(today, OUTREACH_DAILY_CAP - 5);
  const next = slots[today];
  assert.equal(berlinDayOf(next.getTime()), "2026-11-19");
  assert.equal(next.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }), "09:00");
  // Abstand zur letzten Mail wird eingehalten
  const [first] = staggerSchedule(1, { now, sentToday: 0, lastSentAt: new Date(now - 30_000) });
  assert.ok(first.getTime() >= now - 30_000 + OUTREACH_MIN_GAP_MS);
});

test("Kontakt-Extraktor: mailto, Klartext, verschleierte Adressen, Socials, Impressums-Link", () => {
  const html = `<html><body>
    <a href="mailto:business@pokepulls.de?subject=Hi">Mail</a>
    <p>Kooperationen: anfragen [at] pokepulls [dot] de</p>
    <p>Kontakt: hallo&#64;pokepulls.de</p>
    <img src="logo@2x.png"> <span>name@example.com</span>
    <a href="https://www.youtube.com/@PokePulls">YT</a> <a href="https://www.tiktok.com/@pokepulls_de">TT</a>
    <a href="https://instagram.com/pokepulls/">IG</a> <a href="https://www.instagram.com/p/abc123/">Post</a>
    <a href="https://discord.gg/abcDEF">Discord</a>
    <a href="/impressum">Impressum</a>
  </body></html>`;
  const r = extractContacts(html, "https://pokepulls.de/");
  assert.equal(r.emails[0], "business@pokepulls.de");
  assert.ok(r.emails.includes("anfragen@pokepulls.de"));
  assert.ok(r.emails.includes("hallo@pokepulls.de"));
  assert.ok(!r.emails.some((e) => e.includes("example.com") || e.includes("@2x")));
  assert.ok(r.socials.includes("https://www.youtube.com/@PokePulls"));
  assert.ok(r.socials.includes("https://www.tiktok.com/@pokepulls_de"));
  assert.ok(r.socials.includes("https://www.instagram.com/pokepulls"));
  assert.ok(!r.socials.some((s) => s.endsWith("/p")));
  assert.ok(r.socials.includes("https://discord.gg/abcDEF"));
  assert.equal(r.imprint, "https://pokepulls.de/impressum");
});

test("Kontakt-Extraktor: nur öffentliche Adressen (SSRF-Schutz), Plattformen nicht automatisch abrufen", () => {
  assert.equal(checkFetchUrl("https://linktr.ee/pokepulls").ok, true);
  for (const bad of ["http://localhost/", "http://127.0.0.1/", "http://10.0.0.5/x", "http://192.168.1.1", "http://169.254.169.254/latest/meta-data",
    "ftp://x.de", "http://[::1]/", "https://user:pw@site.de", "http://intranet/", "https://x.de:8080/", "file:///etc/passwd"]) {
    assert.equal(checkFetchUrl(bad).ok, false, bad);
  }
  assert.equal(isPrivateIp("172.20.1.1"), true);
  assert.equal(isPrivateIp("::ffff:10.1.2.3"), true);
  assert.equal(isPrivateIp("fd00::1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPlatformHost("www.youtube.com"), true);
  assert.equal(isPlatformHost("m.tiktok.com"), true);
  assert.equal(isPlatformHost("beacons.ai"), false);
});

test("Recherche-Buttons: /about eines YouTube-Kanals, sonst Kanalsuche", () => {
  assert.equal(researchLinks({ name: "Dario", platform: "youtube", channelUrl: "https://www.youtube.com/@dario/videos" }).youtubeAbout, "https://www.youtube.com/@dario/about");
  assert.equal(researchLinks({ name: "X", platform: "youtube", channelUrl: "https://youtube.com/channel/UC123456789012/featured" }).youtubeAbout, "https://www.youtube.com/channel/UC123456789012/about");
  assert.match(researchLinks({ name: "The Zero of Time", platform: "youtube", channelUrl: "" }).youtubeAbout, /results\?search_query=The%20Zero%20of%20Time/);
  assert.match(researchLinks({ name: "Dario", platform: "tiktok", channelUrl: "" }).tiktok, /tiktok\.com\/search\/user\?q=Dario/);
});

test("Online-Radar: Badges kommen nur vom Server (Creator, Gründer, Pro)", () => {
  const future = new Date(Date.now() + 10 * day);
  assert.deepEqual(presenceBadges({ plan: "free", planUntil: null }), []);
  assert.deepEqual(presenceBadges({ plan: "free", planUntil: null, bonusPlan: "pro", bonusUntil: future, creatorAt: new Date(), founderAt: new Date() }), ["creator", "founder", "pro"]);
  assert.deepEqual(presenceBadges({ plan: "premium", planUntil: future }), ["premium"]);
});

test("Online-Radar: Firebase-Regeln erlauben nur Gast-Nr., Bereich und Nonce – keine Namen/Badges", () => {
  for (const f of ["firebase/database.rules.json", "firebase/database.rules.strict.json"]) {
    const r = JSON.parse(readFileSync(f, "utf8")).rules.pokeswipe_radar.presence.$uid;
    assert.ok(r.g && r.a && r.n, f);
    assert.equal(r.$other[".validate"], false);
    assert.match(r[".write"], /auth\.uid === \$uid/);
    assert.ok(!r.name && !r.badge && !r.badges);
  }
  const legacy = readFileSync("public/js/legacy-app.js", "utf8");
  assert.match(legacy, /onDisconnect\(\)\.remove\(\)/);
  assert.match(legacy, /setInterval\(beat, 45 \* 1000\)/);
});

test("Online-Radar & Creator: Client-Module, Seiten und Routen sind verdrahtet", () => {
  assert.ok(existsSync("public/creator.html") && existsSync("public/js/creator.js"));
  const page = readFileSync("public/creator.html", "utf8");
  assert.ok(!/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/i.test(page), "keine Inline-Skripte (CSP)");
  for (const f of ["Kanalname", "platform", "channelUrl", "followers", "email", "wishCode"]) assert.ok(page.includes(f), f);
  const main = readFileSync("client/main.js", "utf8");
  assert.match(main, /initPresence\(\)/);
  assert.match(main, /openCreatorAdmin/);
  const app = readFileSync("server/app.ts", "utf8");
  assert.match(app, /registerCreator\(app/);
  assert.match(app, /registerPresence\(app/);
  const creator = readFileSync("server/creator.ts", "utf8");
  assert.match(creator, /\/api\/admin\/extract-creator-contact/);
  assert.match(creator, /List-Unsubscribe/);
  const trading = readFileSync("server/trading.ts", "utf8");
  assert.match(trading, /binderPartner && !partner\.binderVisible/);
});
