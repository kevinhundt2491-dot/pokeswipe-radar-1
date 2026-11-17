import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDocuments, impressumText, cleanOperator, operatorComplete } from "../server/legal.ts";
import { parseSealedCsv } from "../server/catalog.ts";

const op = cleanOperator({ name: "Erika Muster", street: "Hauptstr. 1", zip: "50667", city: "Köln", email: "info@example.de", phone: "0221 123" });

test("Impressum: vollständige Pflichtangaben und Streitbeilegungs-Hinweis", () => {
  assert.equal(operatorComplete(op), true);
  const t = impressumText(op);
  for (const part of ["Erika Muster", "Hauptstr. 1", "50667 Köln", "E-Mail: info@example.de", "§ 18 Abs. 2 MStV", "Verbraucherschlichtungsstelle"]) assert.ok(t.includes(part), part);
  assert.equal(impressumText(cleanOperator({ name: "Nur Name" })), "");
  assert.ok(impressumText(cleanOperator({}), "Freitext Anbieter").startsWith("Freitext Anbieter"));
});

test("Rechtstexte: AGB, Widerruf (inkl. digitale Leistungen) und Muster-Formular mit Anbieter", () => {
  const docs = buildDocuments(op);
  assert.deepEqual(docs.map((d) => d.id), ["impressum", "datenschutz", "agb", "widerruf", "formular"]);
  const text = (id: string) => docs.find((d) => d.id === id)!.sections.flatMap((s) => [s.h || "", ...s.p]).join("\n");
  assert.ok(text("agb").includes("4,99 €"));
  assert.ok(text("agb").includes("Verträge hier kündigen"));
  assert.ok(text("widerruf").includes("vierzehn Tagen"));
  assert.ok(text("widerruf").includes("§ 356 Abs. 5 BGB"));
  assert.ok(text("formular").includes("Erika Muster"));
  for (const svc of ["Netlify", "Stripe", "Firebase", "eBay Partner Network", "Art. 21 DSGVO"]) assert.ok(text("datenschutz").includes(svc), svc);
  assert.ok(text("datenschutz").includes("Erika Muster"));
});

test("Rechtstexte: keine personenbezogenen Anbieterdaten im Quellcode – eigene Angaben aus dem Admin-Bereich werden verwendet", () => {
  const src = readFileSync("server/legal.ts", "utf8");
  assert.ok(!/DEFAULT_OPERATOR/.test(src));
  const imp = buildDocuments(op).find((d) => d.id === "impressum")!.sections[0].p.join("\n");
  assert.ok(imp.includes("Erika Muster"));
});

test("Impressum: ungültige E-Mail wird verworfen, Felder werden gekürzt", () => {
  const o = cleanOperator({ name: "A".repeat(500), email: "keine-mail" });
  assert.equal(o.email, "");
  assert.equal(o.name.length, 120);
});

test("Sealed-CSV: Semikolon, deutsche Zahlen, Spaltennamen", () => {
  const rows = parseSealedCsv("name;set;kind;ean;uvp;price\nStürmische Funken Display;Stürmische Funken;display;0820650857001;161,64;1.139,90\n\"Box; mit Semikolon\";151;etb;;59,99;");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Stürmische Funken Display");
  assert.equal(rows[0].uvp, 161.64);
  assert.equal(rows[0].refPrice, 1139.9);
  assert.equal(rows[1].name, "Box; mit Semikolon");
  assert.equal(rows[1].refPrice, null);
  assert.deepEqual(parseSealedCsv("foo;bar\n1;2"), []);
});

test("Anbieterangaben: Admin-Einstellungen vor Umgebungsvariablen, leere Felder aus OPERATOR_*", async () => {
  const { operatorFromEnv, mergeOperator, controllerLine } = await import("../server/legal.ts");
  const env = operatorFromEnv({ OPERATOR_NAME: "Erika Muster", OPERATOR_STREET: "Hauptstr. 1", OPERATOR_ZIP: "50667", OPERATOR_CITY: "Köln", OPERATOR_EMAIL: "info@example.de", OPERATOR_SMALL_BUSINESS: "1" });
  const merged = mergeOperator({}, env);
  assert.equal(operatorComplete(merged), true);
  assert.equal(merged.smallBusiness, true);
  assert.match(controllerLine(merged), /Erika Muster, Hauptstr\. 1, 50667 Köln, E-Mail: info@example\.de/);
  // vollständige Admin-Angaben haben Vorrang
  assert.equal(mergeOperator(op, env).phone, "0221 123");
  assert.equal(mergeOperator({ name: "Firma X" }, env).name, "Firma X");
  // ohne Angaben: neutral, keine Daten erfunden
  assert.equal(controllerLine(mergeOperator({}, operatorFromEnv({}))), "");
});

test("Keine hartcodierten persönlichen Anbieterdaten im Client- und Server-Code", () => {
  const files = ["client/growth.js", "client/i18n-en-1.js", "client/i18n-en-3.js", "public/index.html", "server/push.ts", "server/legal.ts", "server/privacy.ts"];
  for (const f of files) {
    const t = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/\+49\s?1\d{2}\s?\d{6,}/.test(t), `Telefonnummer in ${f}`);
    assert.ok(!/info@pokeswipe-radar\.de/.test(t), `E-Mail in ${f}`);
  }
});
