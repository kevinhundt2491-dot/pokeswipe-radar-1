// Kurz-Reels (7–10 s, High-Retention): Vorlagen, Regie-Zeitpläne, Sound-Cues, Spezifikation, Choreografien und Demo-Daten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-ignore – reines JS-Modul
import { SHORT_TEMPLATES, SHORT_TIMELINES, SHORT_RANGE, SHORT_FPS, SHORT_HOOK_Y, ALL_TEMPLATES, templateByKey, templateCues, shortCues, showcaseSpec, showcaseScenes, showcaseScript, showcaseCaption, checkTemplateScript, isShowcase, isShort, frameGrid, TAP_LEAD, DOMAIN } from "../client/reel-pro.js";
// @ts-ignore – reines JS-Modul
import { CHOREO } from "../client/reel-scenarios.js";
// @ts-ignore – reines JS-Modul
import { DEMO_ITEMS, demoItemImage, demoItemListings, demoCardListings } from "../client/reel-demo-items.js";
import { VIDEO_TEMPLATE_KEYS, SHORT_TEMPLATE_KEYS, PRO_TEMPLATE_LABELS, cleanVideoConfig } from "../server/reel-video-logic.ts";
import { ITEM_CATEGORIES, ITEM_CONDITIONS } from "../server/item-listing-logic.ts";

const SFX = ["softhit", "scanhum", "beep", "coin", "drop", "whoosh", "pop", "tap", "pling", "page", "tick", "swipe", "shimmer", "chime"];
const HOOKS: Record<string, string> = {
  shortscan: "Dein Handy scannt Pokémon-Karten jetzt schneller als du blinzeln kannst 👀⚡",
  shortbinder: "Endlich ein digitaler Pokémon-Ordner, der sich anfühlt wie echt 🔥📖",
  shortmarket: "16 echte Sammler-Deals auf einer Seite – einfach spontan mitnehmen 🤯",
  shortitems: "Nicht nur Karten – verkaufe jetzt auch Displays, ETBs & Zubehör ohne Gebühren 📦⚡",
};

test("Kurz-Reels: genau 4 neue Vorlagen, 8–9 s, 60 FPS, Showcase-Familie, im Generator auffindbar", () => {
  assert.deepEqual(SHORT_TEMPLATES.map((t: any) => t.key), ["shortscan", "shortbinder", "shortmarket", "shortitems"]);
  assert.deepEqual([...SHORT_TEMPLATE_KEYS], SHORT_TEMPLATES.map((t: any) => t.key));
  for (const t of SHORT_TEMPLATES) {
    assert.ok(ALL_TEMPLATES.includes(t), t.key);
    assert.equal(templateByKey(t.key), t);
    assert.ok(isShowcase(t) && isShort(t));
    assert.ok(t.exact >= SHORT_RANGE[0] && t.exact <= SHORT_RANGE[1], `${t.key}: ${t.exact} s`);
    assert.deepEqual(t.seconds, [t.exact, t.exact]);
    assert.equal(t.fps, SHORT_FPS);
    assert.equal(t.sfxOnly, true, "Standard: ohne KI-Stimme, nur UI-Soundeffekte");
    assert.equal(t.noFade, true, "kein Ausblenden ins Schwarze (Loop)");
    assert.equal(t.proAt, null);
    assert.ok((VIDEO_TEMPLATE_KEYS as readonly string[]).includes(t.key));
    assert.ok(PRO_TEMPLATE_LABELS[t.key]);
    assert.ok(CHOREO[t.choreo], `Choreografie ${t.choreo}`);
    assert.equal(CHOREO[t.choreo].beats.length, 4);
  }
  assert.equal(frameGrid(8, 60).frames, 480);
  assert.equal(frameGrid(9, 60).frames, 540);
});

test("Kurz-Reels: Hook-Text ab Frame 0 oben, keine generischen Stempel, End-Tag mit Domain", () => {
  for (const t of SHORT_TEMPLATES) {
    const sc = showcaseScript(t, 0);
    assert.equal(sc.cover, HOOKS[t.key]);
    assert.equal(t.overlays.scan, HOOKS[t.key], "Hook = Overlay der ersten Szene (steht ab Frame 0)");
    assert.equal(sc.badge, "", "kein Stempel-Badge");
    assert.doesNotMatch(JSON.stringify(t.hooks), /FUNKTIONS-CHECK|MARKTPLATZ-GUIDE/);
    assert.equal(t.finale.domain, DOMAIN);
    assert.ok(t.lockupAt > t.plan[3] && t.lockupAt < t.exact - 1, `${t.key}: End-Tag steht mind. 1 s`);
  }
  assert.ok(SHORT_HOOK_Y - 3 * 66 * 1.12 / 2 > 200, "Hook bleibt unter der oberen Plattform-Leiste");
  assert.equal(templateByKey("shortscan").finale.sub, "Kostenlos testen");
  assert.equal(templateByKey("shortmarket").finale.sub, "0 % Gebühren zum Start");
});

test("Kurz-Reels: Szenenplan und Regie-Zeitpunkte liegen im Video, Hook-Szene 1,8–2 s", () => {
  for (const t of SHORT_TEMPLATES) {
    assert.equal(t.plan[0], 0);
    assert.equal(t.plan[t.plan.length - 1], t.exact);
    for (let i = 1; i < t.plan.length; i++) assert.ok(t.plan[i] > t.plan[i - 1]);
    assert.ok(t.plan[1] >= 1.5 && t.plan[1] <= 2.0, `${t.key}: Hook ${t.plan[1]} s`);
    const scenes = showcaseScenes(t.exact, t.plan);
    assert.equal(scenes.length, 4);
    assert.equal(scenes[3].end, t.exact);
    const tl = SHORT_TIMELINES[t.key];
    for (const [k, v] of Object.entries(tl)) if (!/Ms$/.test(k)) assert.ok(Number(v) >= 0 && Number(v) < t.exact, `${t.key}.${k}`);
  }
});

test("Kurz-Reels: Mikro-SFX ab Frame 0, höchstens 2 s ohne Schnitt/Aktion, nur bekannte Effekte", () => {
  for (const t of SHORT_TEMPLATES) {
    const scenes = showcaseScenes(t.exact, t.plan);
    const cues = templateCues(t, scenes);
    assert.deepEqual(cues, shortCues(t, scenes));
    assert.ok(cues.length >= 8, t.key);
    assert.ok(cues[0][0] <= 0.05, "sofort hörbar");
    for (const [time, name] of cues) { assert.ok(SFX.includes(name), name); assert.ok(time >= 0 && time <= t.exact); }
    for (let i = 1; i < cues.length; i++) assert.ok(cues[i][0] >= cues[i - 1][0]);
    // visueller Wechsel alle 1,5–2 s: zwischen zwei Aktionen (Cues) liegen nie mehr als 2 s
    const times = [...cues.map(([x]: [number]) => x), t.exact];
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= 2.0 + 1e-9, `${t.key}: Lücke ${times[i - 1]}–${times[i]} s`);
  }
  const tl = SHORT_TIMELINES.shortscan;
  assert.ok(shortCues(templateByKey("shortscan"), showcaseScenes(8, templateByKey("shortscan").plan)).some(([x, n]: [number, string]) => n === "tap" && Math.abs(x - (tl.instantTap + TAP_LEAD)) < 1e-6));
});

test("Kurz-Reels: Spezifikation 7–10 s · 60 FPS · 10–12 Mbit/s · 1080×1920", () => {
  const t = templateByKey("shortbinder");
  assert.equal(showcaseSpec(t, { duration: 9, fps: 60, mbit: 11 }).ok, true);
  assert.equal(showcaseSpec(t, { duration: 12, fps: 60, mbit: 11 }).checks.duration, false);
  assert.equal(showcaseSpec(t, { duration: 9, fps: 30, mbit: 11 }).checks.fps, false);
  assert.equal(showcaseSpec(t, { duration: 9, fps: 60, mbit: 11, width: 720 }).checks.size, false);
});

test("Kurz-Reels: optionales Voiceover-Skript im Wortlimit, Caption mit Domain und max. 10 Hashtags", () => {
  for (const t of SHORT_TEMPLATES) {
    const chk = checkTemplateScript(t, showcaseScript(t, 0).say);
    assert.ok(chk.ok, `${t.key}: ${chk.words} Wörter`);
    const cap = showcaseCaption(t, 0, {});
    assert.match(cap.caption, /pokeswipe-radar\.de/);
    assert.ok(cap.hashtags.length >= 3 && cap.hashtags.length <= 10);
  }
});

test("Kurz-Reels: Generator-Button, Voiceover-Schalter (Standard AUS) und Make.com-Felder", () => {
  const ar = readFileSync(new URL("../client/auto-reels.js", import.meta.url), "utf8");
  assert.match(ar, /data-pro="short"/);
  assert.match(ar, /SHORT_VOICE_KEY, "0"\) === "1"/);
  assert.match(ar, /video_format: "short"/);
  assert.match(ar, /audio_mode: res\.speech \? "voiceover\+sfx" : "sfx-only"/);
  const rec = readFileSync(new URL("../client/reel-pro-recorder.js", import.meta.url), "utf8");
  assert.match(rec, /tpl\.short && !voice \? \[\]/);
  const comp = readFileSync(new URL("../client/reel-compositor.js", import.meta.url), "utf8");
  assert.match(comp, /if \(tpl\?\.noFade\) this\.fade = 0/);
  // Bestehende Rotation bleibt Standard: Kurz-Reels nur, wenn der Admin sie auswählt
  assert.ok(!cleanVideoConfig({}).templates.includes("shortscan"));
  assert.ok(cleanVideoConfig({ templates: ["shortscan"] }).templates.includes("shortscan"));
});

test("Kurz-Reels: Demo-Daten (nur Stage) – echte Katalogkarten mit Deals, Artikel in echten Unterkategorien", () => {
  const cats = ITEM_CATEGORIES.map((c) => c.id), conds = ITEM_CONDITIONS.map((c) => c.id);
  for (const a of DEMO_ITEMS) { assert.ok(cats.includes(a.category), a.title); assert.ok(conds.includes(a.condition), a.title); }
  assert.ok(DEMO_ITEMS.some((a: any) => /Display/.test(a.title)) && DEMO_ITEMS.some((a: any) => /Top-Trainer-Box/.test(a.title)) && DEMO_ITEMS.some((a: any) => /Sammelordner/.test(a.title)));
  assert.match(demoItemImage(DEMO_ITEMS[0]), /^data:image\/svg\+xml/);
  const items = demoItemListings(["data:image/png;base64,AAAA"]);
  assert.equal(items.length, DEMO_ITEMS.length);
  assert.ok(items.every((l: any) => l.id < 0 && l.listing_type === "item"));
  const catalog = Array.from({ length: 30 }, (_, i) => ({ id: `sv03.5-${String(i + 1).padStart(3, "0")}`, name: `Karte ${i + 1}`, image: `https://assets.tcgdex.net/x/${i}`, price: 2 + i }));
  const cards = demoCardListings(catalog);
  assert.ok(cards.length >= 16, "volle 16er-Seite");
  assert.ok(cards.every((l: any) => l.id < 0 && l.price > 0 && l.market_price > 0));
  assert.ok(cards.filter((l: any) => l.price <= l.market_price * 0.85).length >= 8, "Deals unter Cardmarket");
});

test("Kurz-Reels: Stage-Demos ohne Schreibzugriff – nur in der Live-Stage (?reel=1) aktiv", () => {
  const m16 = readFileSync(new URL("../client/market16.js", import.meta.url), "utf8");
  assert.match(m16, /\.\.\.\(IS_STAGE \? \{ m16DemoPrepare, m16DemoMode \} : \{\}\)/);
  const items = readFileSync(new URL("../client/item-listing.js", import.meta.url), "utf8");
  assert.match(items, /\.\.\.\(IS_STAGE \? \{ itemDemoFill \} : \{\}\)/);
  const sc = readFileSync(new URL("../client/reel-scenarios.js", import.meta.url), "utf8");
  const block = sc.slice(sc.indexOf("  shortscan: {"), sc.indexOf("  // 10) App-Tour"));
  assert.doesNotMatch(block, /submitItemListing|m16Buy|openBuy/, "kein echtes Inserat, kein Kauf");
  assert.match(block, /tapVisual\(sub\)/);
});
