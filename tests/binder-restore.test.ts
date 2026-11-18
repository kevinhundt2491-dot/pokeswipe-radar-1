// Set-Binder wiederhergestellt: Startseiten-Schnellzugriff, graue fehlende Karten, Marktplatz-Direktlink an Lücken,
// Benachrichtigung bei neuen Angeboten für fehlende Binder-Karten und Scanner-Auto-Save/Auto-Close.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldAutoClose, shouldAutoFile } from "../client/scanner/scan-ui-logic.js";
import { sanitizePrefs } from "../server/profile-prefs-logic.ts";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("Scanner: sicher erkannte Karte schließt sich nach kurzem Moment selbst – unsicher, Gast, Bühne oder in Bearbeitung nicht", () => {
  const hit = { info: { key: "card:sv08-1" } };
  assert.equal(shouldAutoClose(hit, { loggedIn: true }), true);
  assert.equal(shouldAutoClose({ ...hit, unsure: true }, { loggedIn: true }), false);
  assert.equal(shouldAutoClose({ ...hit, hold: true }, { loggedIn: true }), false);
  assert.equal(shouldAutoClose(hit, { loggedIn: false }), false);
  assert.equal(shouldAutoClose(hit, { loggedIn: true, stage: true }), false);
  assert.equal(shouldAutoFile(hit, { loggedIn: true }), true);
});

test("Scanner: Treffer wird sofort gespeichert (presentHit → autoFileCurrent + armAutoClose), Korrekturen buchen um", () => {
  const s = src("client/scanner/live-scanner.js");
  const present = s.slice(s.indexOf("function presentHit("), s.indexOf("// Auto-Save + Auto-Close"));
  const after = present.slice(present.indexOf("sc.current = {"));
  assert.match(after, /autoFileCurrent\(\);\s+armAutoClose\(sc\.current\);/);
  assert.match(s, /function refileCurrent\(\)/);
  assert.match(s, /liveScanNext: \(\) => \{ autoFileCurrent\(\); nextCard\(\); \}/);
  assert.match(s, /data-hud-next/);
  // Foto-Upload in der Sammlung speichert ebenfalls automatisch
  assert.match(s, /pq\.filedKey = infos\[0\]\.key;/);
});

test("Binder: fehlende Karten grau, Lücke mit Angebot → Preis + „Jetzt im Marktplatz ansehen / kaufen“, sonst Suchauftrag/Marktplatz", () => {
  const css = src("public/theme.css");
  assert.match(css, /\.ps-bslot\.missing \.ps-bslot-art img \{[^}]*grayscale\(1\)/);
  const b = src("client/binder.js");
  assert.match(b, /Jetzt im Marktplatz ansehen \/ kaufen/);
  assert.match(b, /Suchauftrag aktivieren/);
  assert.match(b, /Zum Marktplatz gehen/);
  assert.match(b, /data-binder-pct/);
  assert.match(b, /Seite \$\{view\.page \+ 1\} \/ \$\{n\}/);
  const html = src("public/index.html");
  assert.ok(html.includes('id="home-set-binder"'), "Schnellzugriff auf der Startseite");
  assert.ok(html.includes('id="ps-binder-folders"'), "Set-Ordner in Sammlung / Binder");
});

test("Benachrichtigung: neues Inserat → Sammler mit Lücke im Set-Ordner (In-App + Push, Direktlink), abschaltbar", () => {
  const g = src("server/growth.ts");
  assert.match(g, /export async function notifyBinderGapListing/);
  assert.match(g, /await notifyBinderGapListing\(row, sellerName, sellerId\)/);
  assert.match(g, /NOT EXISTS \(SELECT 1 FROM portfolio_items o WHERE o\.user_id = pi\.user_id AND o\.card_id = \$\{cardId\}\)/);
  assert.match(g, /binderAlerts/);
  assert.match(g, /listingLink\(row\.id\)/);
  assert.deepEqual(sanitizePrefs({ binderAlerts: false }), { binderAlerts: false });
  assert.deepEqual(sanitizePrefs({ binderAlerts: "nein" }), {});
  assert.match(src("client/market.js"), /q\.get\("listing"\)/);
  assert.match(src("client/main.js"), /tab=map&listing=/);
});
