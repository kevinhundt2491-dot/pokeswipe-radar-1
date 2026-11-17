// Security-/DAC7-Upgrade: Feldverschlüsselung, Maskierung, Treuhand-Freigabe ab Zustellung, Netto-Flip, eBay-Signatur
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { encryptWith, decryptWith, isEncrypted, keyIdOf, parseKey, maskIban, maskTaxId, maskBirthDate, VaultError } from "../server/vault-logic.ts";
import {
  initialReleaseAfter, releaseAfterDelivery, releaseDecision, parseDhlTracking, trackingCheckDue, trackingIntervalMs,
  RELEASE_AFTER_DELIVERY_DAYS, TRACKING_FALLBACK_DAYS,
} from "../server/escrow-tracking-logic.ts";
import { netFlip, netFlipAll, shippingEstimate } from "../server/flip-logic.ts";
import { parseSignatureHeader, verifyEbaySignature, normalizePem } from "../server/ebay-signature-logic.ts";
import { dac7Reportable, DAC7_GROSS_THRESHOLD_CENTS } from "../server/dac7-logic.ts";

const DAY = 86400_000;

test("Vault: AES-256-GCM verschlüsselt, entschlüsselt und bindet an den Feldnamen", () => {
  const key = randomBytes(32);
  const enc = encryptWith(key, "env", "DE89370400440532013000", "iban");
  assert.ok(isEncrypted(enc));
  assert.equal(keyIdOf(enc), "env");
  assert.ok(!enc.includes("DE89370400440532013000"));
  assert.equal(decryptWith({ env: key }, enc, "iban"), "DE89370400440532013000");
  // gleicher Klartext → unterschiedliche Chiffrate (zufälliger IV)
  assert.notEqual(encryptWith(key, "env", "x", "iban"), encryptWith(key, "env", "x", "iban"));
  // falsches Feld (AAD), falscher Schlüssel, manipulierte Daten → Fehler
  assert.throws(() => decryptWith({ env: key }, enc, "tax_id"), VaultError);
  assert.throws(() => decryptWith({ env: randomBytes(32) }, enc, "iban"), VaultError);
  assert.throws(() => decryptWith({}, enc, "iban"), VaultError);
  const parts = enc.split(":"); parts[5] = Buffer.from("manipuliert").toString("base64");
  assert.throws(() => decryptWith({ env: key }, parts.join(":"), "iban"), VaultError);
  // Klartext-Alteinträge werden erkannt
  assert.equal(isEncrypted("12345678901"), false);
});

test("Vault: Schlüssel aus DATA_ENCRYPTION_KEY (Hex, Base64, Passphrase)", () => {
  assert.equal(parseKey("")?.length ?? 0, 0);
  assert.equal(parseKey("zu-kurz"), null);
  assert.equal(parseKey("a".repeat(64))!.length, 32);
  assert.equal(parseKey(randomBytes(32).toString("base64"))!.length, 32);
  assert.equal(parseKey("eine sehr lange geheime passphrase mit mehr als 32 zeichen")!.length, 32);
});

test("Maskierung: IBAN, Steuer-ID, Geburtsdatum", () => {
  assert.equal(maskIban("DE89 3704 0044 0532 0130 00"), "DE89 •••• •••• 3000");
  assert.equal(maskTaxId("12345678123"), "•••• •••• 123");
  assert.equal(maskBirthDate("1990-04-12"), "••.••.1990");
  assert.equal(maskIban(""), "");
  assert.equal(maskTaxId(null), "");
  assert.equal(maskBirthDate(""), "");
});

test("DAC7: genau 2.000,00 € ist nicht meldepflichtig, 2.000,01 € schon (§ 4 Abs. 5 PStTG)", () => {
  const s = (transactions: number, grossCents: number) => ({ transactions, grossCents, refundedCents: 0 });
  assert.equal(dac7Reportable(s(5, DAC7_GROSS_THRESHOLD_CENTS)), false);
  assert.equal(dac7Reportable(s(5, DAC7_GROSS_THRESHOLD_CENTS + 1)), true);
  assert.equal(dac7Reportable(s(30, 0)), true);
});

test("Treuhand: Auszahlungsfrist startet erst ab DHL-Zustellung", () => {
  const shipped = new Date("2026-11-01T10:00:00Z");
  // verfolgbar → spätester Fallback 21 Tage; ohne Tracking bisherige 14 Tage; Sandbox wie nicht verfolgbar
  assert.equal(initialReleaseAfter("dhl", true, shipped, 14).getTime(), shipped.getTime() + TRACKING_FALLBACK_DAYS * DAY);
  assert.equal(initialReleaseAfter("dhl", false, shipped, 14).getTime(), shipped.getTime() + 14 * DAY);
  assert.equal(initialReleaseAfter("hermes", true, shipped, 14).getTime(), shipped.getTime() + 14 * DAY);
  assert.equal(initialReleaseAfter("dhl", true, shipped, 14, true).getTime(), shipped.getTime() + 14 * DAY);
  const delivered = new Date("2026-11-03T09:00:00Z");
  const rel = releaseAfterDelivery(delivered);
  assert.equal(rel.getTime(), delivered.getTime() + RELEASE_AFTER_DELIVERY_DAYS * DAY);
  const base = { carrier: "dhl", shippedAt: shipped };
  // zugestellt, Frist abgelaufen → Auszahlung
  assert.equal(releaseDecision({ ...base, trackingStatus: "delivered", deliveredAt: delivered, releaseAfter: rel }, true, new Date(rel.getTime() + 1000)).action, "release");
  // zugestellt, Frist läuft → warten
  assert.equal(releaseDecision({ ...base, trackingStatus: "delivered", deliveredAt: delivered, releaseAfter: rel }, true, new Date(rel.getTime() - 1000)).action, "wait");
  const fallback = new Date(shipped.getTime() + TRACKING_FALLBACK_DAYS * DAY + 1000);
  // kein Zustell-Scan, aber Transport-Scan → Fallback-Auszahlung nach 21 Tagen
  assert.equal(releaseDecision({ ...base, trackingStatus: "transit", deliveredAt: null, releaseAfter: new Date(fallback.getTime() - 2000) }, true, fallback).action, "release");
  // ohne jeden Versandnachweis → keine Auszahlung, Prüfung
  assert.equal(releaseDecision({ ...base, trackingStatus: "pre-transit", deliveredAt: null, releaseAfter: new Date(fallback.getTime() - 2000) }, true, fallback).action, "review");
  assert.equal(releaseDecision({ ...base, trackingStatus: "failure", deliveredAt: null, releaseAfter: new Date(fallback.getTime() - 2000) }, true, fallback).action, "review");
  // nicht verfolgbarer Paketdienst → bisherige Regel
  assert.equal(releaseDecision({ carrier: "dpd", shippedAt: shipped, trackingStatus: "", deliveredAt: null, releaseAfter: new Date(shipped.getTime() + 14 * DAY) }, true, new Date(shipped.getTime() + 15 * DAY)).action, "release");
});

test("Treuhand: DHL-Tracking-Antwort und Prüfabstände", () => {
  const delivered = parseDhlTracking(200, { shipments: [{ status: { statusCode: "delivered", timestamp: "2026-11-03T09:12:00Z", description: "Zugestellt" }, events: [{ statusCode: "delivered", timestamp: "2026-11-03T09:12:00Z" }] }] });
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.deliveredAt?.toISOString(), "2026-11-03T09:12:00.000Z");
  assert.equal(parseDhlTracking(404, null).status, "pre-transit");
  assert.equal(parseDhlTracking(200, { shipments: [{ status: { statusCode: "transit" } }] }).status, "transit");
  assert.equal(parseDhlTracking(200, { shipments: [{ status: { statusCode: "seltsam" }, events: [{ statusCode: "transit" }] }] }).status, "transit");
  assert.equal(parseDhlTracking(500, null).status, "unknown");
  assert.ok(trackingIntervalMs(0) < trackingIntervalMs(10) && trackingIntervalMs(10) < trackingIntervalMs(30));
  const now = new Date("2026-11-03T12:00:00Z");
  assert.equal(trackingCheckDue({ trackingCheckedAt: null, trackingChecks: 0 }, now), true);
  assert.equal(trackingCheckDue({ trackingCheckedAt: new Date(now.getTime() - 30 * 60_000), trackingChecks: 0 }, now), false);
  assert.equal(trackingCheckDue({ trackingCheckedAt: new Date(now.getTime() - 2 * 3600_000), trackingChecks: 0 }, now), true);
});

test("Netto-Flip: Gebühren und Porto werden abgezogen", () => {
  assert.equal(shippingEstimate(10), 1.35);
  assert.equal(shippingEstimate(40), 3.7);
  assert.equal(shippingEstimate(150), 6.99);
  assert.equal(shippingEstimate(10, "sealed"), 6.99);
  assert.equal(shippingEstimate(10, "card", "psa10"), 6.99);
  // 40 € einkaufen (inkl. Versand), für 60 € über Cardmarket verkaufen: 60 − 3 (5 %) − 3,70 Porto − 40 = 13,30 €
  const r = netFlip({ buyTotal: 40, resale: 60, channel: "cardmarket", buyShippingIncluded: true })!;
  assert.equal(r.fees, 3);
  assert.equal(r.shipping, 3.7);
  assert.equal(r.net, 13.3);
  assert.equal(r.marginPct, 22.2);
  assert.equal(r.roiPct, 33.3);
  // eBay gewerblich: 11 % + 0,35 € → 60 − 6,95 − 3,70 − 40 = 9,35 €
  assert.equal(netFlip({ buyTotal: 40, resale: 60, channel: "ebay" })!.net, 9.35);
  // Einkaufsporto bei Cardmarket-„ab“-Preisen
  assert.equal(netFlip({ buyTotal: 8, resale: 10, buyShippingIncluded: false })!.buyShipping, 1.35);
  // Brutto-Deal, der netto Verlust macht
  const loss = netFlip({ buyTotal: 7.5, resale: 10, buyShippingIncluded: false })!;
  assert.equal(loss.profitable, false);
  assert.ok(loss.net < 0);
  const all = netFlipAll({ buyTotal: 40, resale: 60 })!;
  assert.deepEqual(Object.keys(all).sort(), ["cardmarket", "ebay", "pokeswipe"]);
  assert.equal(netFlip({ buyTotal: 0, resale: 60 }), null);
});

test("eBay-Kontolöschung: ECDSA-Signatur wird geprüft, Fälschungen abgelehnt", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  // eBay liefert das PEM ohne Zeilenumbrüche
  const pemFlat = (publicKey.export({ type: "spki", format: "pem" }) as string).replace(/\n/g, "");
  assert.ok(normalizePem(pemFlat).startsWith("-----BEGIN PUBLIC KEY-----\n"));
  const body = JSON.stringify({ metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION" }, notification: { notificationId: "n1", data: { username: "max" } } });
  const signature = sign("sha1", Buffer.from(body), privateKey).toString("base64");
  const header = Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "abc-123", signature, digest: "SHA1" })).toString("base64");
  const parsed = parseSignatureHeader(header)!;
  assert.equal(parsed.kid, "abc-123");
  assert.equal(verifyEbaySignature(body, parsed, pemFlat), true);
  // Formatierter Body (andere Leerzeichen) wird wie im eBay-SDK kompakt geprüft
  assert.equal(verifyEbaySignature(JSON.stringify(JSON.parse(body), null, 2), parsed, pemFlat), true);
  // manipulierter Inhalt / fremder Schlüssel / kaputter Header
  assert.equal(verifyEbaySignature(body.replace("max", "eve"), parsed, pemFlat), false);
  const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ type: "spki", format: "pem" }) as string;
  assert.equal(verifyEbaySignature(body, parsed, other), false);
  assert.equal(parseSignatureHeader("kein-base64-json"), null);
  assert.equal(parseSignatureHeader(Buffer.from(JSON.stringify({ alg: "rsa", kid: "x", signature: "AAAA" })).toString("base64")), null);
  assert.equal(parseSignatureHeader(""), null);
});
