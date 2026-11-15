import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrivacyPolicy, privacyPage, PRIVACY_STAND } from "../server/privacy.ts";
import { cleanOperator, operatorComplete } from "../server/legal.ts";

const op = cleanOperator({ name: "Erika <Muster>", street: "Hauptstr. 1 & 2", zip: "50667", city: "Köln", email: "info@example.de" });
const render = (o = op, legacy = "") => privacyPage(buildPrivacyPolicy(o, { complete: operatorComplete(o), legacy }));

test("Datenschutz: enthält die Pflichtabschnitte nach Art. 13/14 DSGVO", () => {
  const doc = buildPrivacyPolicy(op, { complete: true });
  const ids = doc.sections.map((s) => s.id);
  for (const id of ["verantwortlicher", "dsb", "hosting", "endgeraet", "konto", "push", "ki", "zahlung", "marktplatz", "dac7", "community",
    "moderation", "karten", "firebase", "kartendaten", "partner", "teilen", "kuendigung", "sicherheit", "drittland", "loeschung", "art22",
    "minderjaehrige", "rechte", "widerspruch", "beschwerde", "aenderungen"]) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
  const html = render();
  for (const part of ["Netlify, Inc.", "Stripe Payments Europe", "Anthropic PBC", "europe-west1", "Nominatim", "PStTG", "§ 25 TDDDG", "§ 147 AO",
    "Art. 21 DSGVO", "Art. 77 DSGVO", "Data Privacy Framework", "info@example.de", "50667 Köln", PRIVACY_STAND]) assert.ok(html.includes(part), part);
  assert.ok(doc.sections.find((s) => s.id === "widerspruch")!.highlight);
});

test("Datenschutz: Anbieterdaten werden escaped", () => {
  const html = render();
  assert.ok(html.includes("Erika &#60;Muster&#62;"));
  assert.ok(html.includes("Hauptstr. 1 &#38; 2"));
  assert.ok(!html.includes("<Muster>"));
});

test("Datenschutz: ohne Anbieterdaten Verweis aufs Impressum bzw. Freitext, keine Platzhalter", () => {
  const empty = render(cleanOperator({}));
  assert.ok(empty.includes("im Impressum"));
  assert.ok(!/Max Mustermann|TODO|\[.*?\]/.test(empty));
  assert.ok(render(cleanOperator({}), "Freitext GmbH").includes("Freitext GmbH"));
});
