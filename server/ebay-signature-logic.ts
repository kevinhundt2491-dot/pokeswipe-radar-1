// eBay Marketplace Account Deletion: kryptografische Prüfung des Headers X-EBAY-SIGNATURE (reine Logik, tests/ebay-signature.test.ts).
//
// eBay signiert jede Benachrichtigung mit ECDSA. Der Header ist Base64-kodiertes JSON:
//   {"alg":"ecdsa","kid":"<Schlüssel-ID>","signature":"<DER-Signatur, Base64>","digest":"SHA1"}
// Der öffentliche Schlüssel zur kid kommt von GET https://api.ebay.com/commerce/notification/v1/public_key/{kid}
// (Antwort: {"algorithm":"ECDSA","digest":"SHA1","key":"-----BEGIN PUBLIC KEY-----…-----END PUBLIC KEY-----"}).
// Signiert ist der Nachrichtentext (JSON). Fehlt der Header → 401, ist er ungültig/gefälscht → 412 (wie im eBay-SDK).
import { createPublicKey, verify } from "node:crypto";

export type EbaySignatureHeader = { alg: string; kid: string; signature: string; digest: string };

/** Header dekodieren; null bei Fehlformat. */
export function parseSignatureHeader(raw: string | null | undefined): EbaySignatureHeader | null {
  const v = String(raw ?? "").trim();
  if (!v || v.length > 4096) return null;
  try {
    const j = JSON.parse(Buffer.from(v, "base64").toString("utf8"));
    const alg = String(j?.alg || "").toLowerCase(), kid = String(j?.kid || ""), signature = String(j?.signature || ""), digest = String(j?.digest || "SHA1").toUpperCase();
    if (alg !== "ecdsa" || !/^[A-Za-z0-9._-]{1,128}$/.test(kid) || !/^[A-Za-z0-9+/=]{16,512}$/.test(signature)) return null;
    if (!["SHA1", "SHA256"].includes(digest)) return null;
    return { alg, kid, signature, digest };
  } catch { return null; }
}

/** eBay liefert den PEM-Schlüssel ohne Zeilenumbrüche – in gültiges PEM umformen. */
export function normalizePem(key: string): string {
  const body = String(key || "").replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) throw new Error("Ungültiger öffentlicher Schlüssel");
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Signatur prüfen. Geprüft wird zuerst der unveränderte Rohtext, danach (wie im offiziellen eBay-SDK)
 * die kompakte JSON-Serialisierung – so stören Leerzeichen/Zeilenumbrüche im Transport nicht.
 */
export function verifyEbaySignature(rawBody: string, header: EbaySignatureHeader, publicKeyPem: string): boolean {
  let key;
  try { key = createPublicKey(normalizePem(publicKeyPem)); } catch { return false; }
  const sig = Buffer.from(header.signature, "base64");
  const alg = header.digest === "SHA256" ? "sha256" : "sha1";
  const candidates = [rawBody];
  try { const compact = JSON.stringify(JSON.parse(rawBody)); if (compact !== rawBody) candidates.push(compact); } catch {}
  for (const text of candidates) {
    try { if (verify(alg, Buffer.from(text, "utf8"), key, sig)) return true; } catch {}
  }
  return false;
}
