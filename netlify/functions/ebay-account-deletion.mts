// PokeSwipe & Radar – eBay Marketplace Account Deletion/Closure Notifications (Pflicht für eBay-Production-Keys).
//
// Endpoint: https://pokeswipe-radar.de/.netlify/functions/ebay-account-deletion
//
// GET  ?challenge_code=…  → { "challengeResponse": sha256(challengeCode + verificationToken + endpoint) } (HTTP 200)
// POST (Benachrichtigung) → kryptografische Prüfung von X-EBAY-SIGNATURE (ECDSA, öffentlicher Schlüssel von eBay):
//        fehlender Header → 401, ungültige/gefälschte Signatur → 412, Schlüssel nicht abrufbar → 503 (eBay wiederholt).
//      Erst nach gültiger Signatur: { "status": "acknowledged" } (HTTP 200). Hat der gelöschte eBay-Nutzer Angebote im
//      Flip-Radar, wird sein gespeicherter Verkäufername dort sofort entfernt (die App speichert sonst keine eBay-Nutzerdaten).
//
// Umgebungsvariablen:
//   EBAY_VERIFICATION_TOKEN  – selbst gewählter Token (32–80 Zeichen: A–Z, a–z, 0–9, _ und -), identisch im eBay-Developer-Portal eintragen
//   EBAY_ENDPOINT_URL        – optional; muss exakt der im eBay-Portal eingetragenen URL entsprechen
//   EBAY_CLIENT_ID / EBAY_CLIENT_SECRET – Production-Keyset (für den Abruf des Notification-Public-Keys)
import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";
import { applicationToken } from "../../server/ebay.ts";
import { parseSignatureHeader, verifyEbaySignature } from "../../server/ebay-signature-logic.ts";

const DEFAULT_ENDPOINT = "https://pokeswipe-radar.de/.netlify/functions/ebay-account-deletion";
const MAX_BODY_BYTES = 64 * 1024;
const KEY_URL = "https://api.ebay.com/commerce/notification/v1/public_key/";
const KEY_TTL_MS = 60 * 60_000;
// Öffentliche Schlüssel (nicht geheim) je kid für eine Stunde im Speicher der Funktion zwischenspeichern
const keyCache = new Map<string, { pem: string; at: number }>();

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

const verificationToken = () => String(process.env.EBAY_VERIFICATION_TOKEN || "").trim();
const endpointUrl = () => String(process.env.EBAY_ENDPOINT_URL || "").trim() || DEFAULT_ENDPOINT;

/** SHA-256 (hex) aus challengeCode + verificationToken + endpoint – genau in dieser Reihenfolge, wie eBay es verlangt. */
export function challengeResponse(challengeCode: string, token: string, endpoint: string) {
  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(token);
  hash.update(endpoint);
  return hash.digest("hex");
}

/** Öffentlichen Notification-Schlüssel zur kid bei eBay abrufen (mit Zwischenspeicher). */
async function publicKey(kid: string): Promise<string> {
  const hit = keyCache.get(kid);
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.pem;
  const token = await applicationToken();
  if (!token) throw new Error("EBAY_CLIENT_ID/EBAY_CLIENT_SECRET fehlen – Signatur kann nicht geprüft werden");
  const res = await fetch(`${KEY_URL}${encodeURIComponent(kid)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return ""; // unbekannte kid → Signatur ungültig
  if (!res.ok) throw new Error(`eBay-Public-Key HTTP ${res.status}`);
  const data: any = await res.json().catch(() => ({}));
  const pem = String(data?.key || "");
  if (!pem) throw new Error("eBay-Public-Key leer");
  keyCache.set(kid, { pem, at: Date.now() });
  return pem;
}

/** Gespeicherte Verkäufernamen des gelöschten eBay-Kontos aus dem Flip-Radar entfernen (Fehler blockieren die Bestätigung nicht). */
async function scrubSeller(username: unknown) {
  const name = String(username || "").trim().slice(0, 60);
  if (!name) return 0;
  try {
    const { pool } = getDatabase();
    const res = await pool.query("UPDATE market_offers SET seller = '', seller_feedback_pct = NULL, seller_feedback_score = NULL WHERE seller = $1", [name]);
    return Number(res?.rowCount) || 0;
  } catch (e: any) {
    console.warn("eBay-Kontolöschung: Bereinigung fehlgeschlagen", e?.message || e);
    return 0;
  }
}

export default async (req: Request) => {
  if (req.method === "GET") {
    const challengeCode = new URL(req.url).searchParams.get("challenge_code");
    if (!challengeCode) return json(400, { error: "challenge_code fehlt" });
    if (challengeCode.length > 512) return json(400, { error: "challenge_code ungültig" });
    const token = verificationToken();
    if (!token) {
      console.error("eBay-Kontolöschung: EBAY_VERIFICATION_TOKEN ist nicht gesetzt");
      return json(503, { error: "Endpoint noch nicht eingerichtet (EBAY_VERIFICATION_TOKEN fehlt)" });
    }
    return json(200, { challengeResponse: challengeResponse(challengeCode, token, endpointUrl()) });
  }

  if (req.method === "POST") {
    const text = await req.text().catch(() => "");
    if (text.length > MAX_BODY_BYTES) return json(413, { error: "Nachricht zu groß" });

    // 1. Signatur prüfen – ohne gültige eBay-Signatur wird nichts gelöscht und nichts bestätigt
    const rawHeader = req.headers.get("x-ebay-signature");
    if (!rawHeader) return json(401, { error: "X-EBAY-SIGNATURE fehlt" });
    const header = parseSignatureHeader(rawHeader);
    if (!header) return json(412, { error: "X-EBAY-SIGNATURE ungültig" });
    let pem = "";
    try { pem = await publicKey(header.kid); }
    catch (e: any) {
      console.error("eBay-Kontolöschung: öffentlicher Schlüssel nicht abrufbar", e?.message || e);
      return json(503, { error: "Signaturprüfung vorübergehend nicht möglich" });
    }
    if (!pem || !verifyEbaySignature(text, header, pem)) {
      console.warn("eBay-Kontolöschung: Signatur abgelehnt", JSON.stringify({ kid: header.kid.slice(0, 40) }));
      return json(412, { error: "Signatur ungültig" });
    }

    // 2. Inhalt auswerten
    let payload: any = null;
    try { payload = JSON.parse(text); } catch { payload = null; }
    if (!payload) return json(400, { error: "Ungültiges JSON" });
    const topic = String(payload?.metadata?.topic || "");
    const data = payload?.notification?.data || {};
    let scrubbed = 0;
    if (topic === "MARKETPLACE_ACCOUNT_DELETION") scrubbed = await scrubSeller(data.username);
    // Nur technische Kennung protokollieren – keine Nutzernamen/IDs ins Log
    console.log("eBay-Kontolöschung bestätigt", JSON.stringify({
      topic: topic || "unbekannt",
      notificationId: String(payload?.notification?.notificationId || "").slice(0, 80),
      scrubbedOffers: scrubbed,
    }));
    return json(200, { status: "acknowledged" });
  }

  return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
};
