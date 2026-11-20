import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore – Client-Modul ohne Typen
import { PRO4_TEMPLATES, PRO_TEMPLATES, ALL_TEMPLATES, templateByKey, proScript, checkTemplateScript, scenesFor, HOOK4_SCENES, DOMAIN, isHook4, isPro4, proCaption, sellOptions, captionChunks, PRO4_FOLDER, ARCHIVE_FOLDER, DRIVE_FOLDER } from "../client/reel-pro.js";
// @ts-ignore – Client-Modul ohne Typen
import { CHOREO } from "../client/reel-scenarios.js";
import { speakable, countWords, narrationMaxWords, narrationMaxChars } from "../server/voiceover.ts";

const BRIEF: Record<string, string> = {
  p4binder: "Schluss mit unsortierten Kartenstapeln und Zettelwirtschaft! Auf PokeSwipe Radar scannst du deine Pokémon-Karte einfach ein – und sie sortiert sich vollautomatisch inklusive aktuellem Cardmarket-Preis an ihren exakten Platz in deinem digitalen Set-Binder ein. Du blätterst mit der realistischen Switch-Funktion wie in einem echten Sammelalbum durch deine Seiten und siehst sofort deinen Fortschritt. Jetzt kostenlos testen auf pokeswipe-radar.de!",
  p4gaps: "Du willst dein Pokémon-Set endlich voll bekommen, weißt aber nie genau, welche Karten noch fehlen? Im digitalen Set-Binder auf PokeSwipe Radar siehst du jede fehlende Karte sofort als grauen Platzhalter. Ein Tipp auf die Lücke genügt – und du kaufst die Karte mit einem einzigen Klick direkt auf unserem Marktplatz, bei eBay oder Cardmarket. Alles von einer Seite aus auf pokeswipe-radar.de!",
  p4dupes: "Doppelte Pokémon-Karten liegen bei dir nur in der Box rum? Mach sie in Sekunden zu Geld! Auf PokeSwipe Radar stellst du Doppelte direkt aus deinem digitalen Binder mit einem Klick auf den Marktplatz – entweder zum normalen Cardmarket-Preis oder direkt 5 bis 10 Prozent günstiger für den Blitzverkauf. Lokal per Safe-Trade in deiner Nähe oder deutschlandweit mit Käuferschutz auf pokeswipe-radar.de!",
  p4all: "Warum gibt es eigentlich keine App, die für Pokémon-Sammler, Käufer und Verkäufer alles an einem Ort vereint? Genau dafür haben wir PokeSwipe Radar gebaut! Egal ob du deine Sammlung im Blick behalten willst oder gezielt nach guten Deals suchst: Du scannst deine Karten ein, sie sortieren sich automatisch mit Live-Preisen in deinen digitalen Set-Binder ein und du blätterst durch deine Sets wie in einem echten Album. Jede fehlende Karte siehst du auf einen Blick und holst sie dir mit einem Klick über unseren Marktplatz, eBay oder Cardmarket. Und wenn du Doppelte hast? Ein Klick im Binder reicht – und dein Inserat ist blitzschnell live, auf Wunsch direkt 5 oder 10 Prozent unter Marktpreis für einen sofortigen Verkauf! Dazu kommen das Live-Sammler-Radar auf Google Maps für sichere Tausch-Deals vor Ort und der Echtzeit-Preiswächter. Komplett kostenlos im Browser – probier es jetzt aus auf pokeswipe-radar.de!",
};

test("Aktuelle Pro-Videos: 4 Vorlagen im Haupt-Ordner, nicht in Rotation/Archiv", () => {
  assert.equal(PRO4_FOLDER, "🔥 Pro-Videos: Set-Binder & Marktplatz (Aktuell)");
  assert.equal(ARCHIVE_FOLDER, "📁 Archiv / Bisherige Vorlagen");
  assert.equal(DRIVE_FOLDER, "werbe videos pokeswipe");
  assert.deepEqual(PRO4_TEMPLATES.map((t: any) => t.key), ["p4binder", "p4gaps", "p4dupes", "p4all"]);
  for (const t of PRO4_TEMPLATES) {
    assert.equal(templateByKey(t.key), t);
    assert.ok(isPro4(t) && isHook4(t));
    assert.ok(!PRO_TEMPLATES.includes(t) && !ALL_TEMPLATES.includes(t));
    assert.deepEqual(scenesFor(t), HOOK4_SCENES);
    assert.ok(CHOREO[t.choreo] && CHOREO[t.choreo].beats.length === 4, `${t.key}: Choreografie`);
  }
});

test("Aktuelle Pro-Videos: Untertitel entsprechen exakt dem Briefing, Domain gesprochen ausgeschrieben", () => {
  for (const t of PRO4_TEMPLATES) {
    const s = proScript(t, 0);
    assert.equal(s.say.length, 4);
    assert.equal(s.show.join(" "), BRIEF[t.key], t.key);
    assert.ok(s.show[3].includes(DOMAIN));
    assert.ok(!speakable(s.say.join(" ")).includes("pokeswipe-radar.de"));
    assert.ok(proCaption(t, 0).caption.includes(DOMAIN));
  }
});

test("Aktuelle Pro-Videos: Server-Limits (Format pro4) reichen auch für das lange Erklärvideo", () => {
  const lim = narrationMaxChars("pro4");
  for (const t of PRO4_TEMPLATES) {
    const say = proScript(t, 0).say;
    const chk = checkTemplateScript(t, say);
    assert.ok(chk.ok, `${t.key}: ${chk.words} Wörter`);
    const spoken = say.map((l: string) => speakable(l));
    assert.ok(countWords(spoken) <= narrationMaxWords(t.voiceFormat), `${t.key}: Wortlimit`);
    assert.ok(spoken.every((l: string) => l.length <= lim.line), `${t.key}: Satzlänge`);
    assert.ok(spoken.join(" ").length <= lim.total, `${t.key}: Gesamtlänge`);
  }
  assert.equal(narrationMaxWords("hook4"), 72); // bestehende Vorlagen unverändert
  assert.deepEqual(narrationMaxChars(""), { line: 320, total: 900 });
  const [a, b, c, d] = PRO4_TEMPLATES.map((t: any) => t.seconds);
  for (const s of [a, b, c]) assert.ok(s[0] <= 20 && s[1] >= 20);
  assert.ok(d[0] <= 35 && d[1] >= 40);
});

test("1-Klick-Verkauf: Cardmarket-Preis, −5 % und −10 %", () => {
  assert.deepEqual(sellOptions(12.9).map((o: string[]) => o[1]), ["12,90 €", "12,26 €", "11,61 €"]);
});

test("Untertitel: Gedankenstriche hängen am Wort davor, echte Wort-Zeitstempel bleiben nutzbar", () => {
  const marks = [{ start: 0, end: 2.5 }];
  const words = [[{ start: 0, end: 0.4 }, { start: 0.5, end: 0.9 }, { start: 1.0, end: 1.4 }, { start: 1.6, end: 2.0 }, { start: 2.1, end: 2.5 }]];
  const flat = captionChunks(["Ein Tipp genügt – und los"], marks, words).flatMap((c: any) => c.words);
  assert.deepEqual(flat.map((w: any) => w.w), ["Ein", "Tipp", "genügt –", "und", "los"]);
  assert.deepEqual(flat.map((w: any) => w.start), [0, 0.5, 1.0, 1.6, 2.1]);
});
