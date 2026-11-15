// PokeSwipe & Radar – eBay Marketplace Account Deletion/Closure Notifications (Pflicht für eBay-Production-Keys).
//
// Endpoint: https://pokeswipe-radar.de/.netlify/functions/ebay-account-deletion
//
// GET  ?challenge_code=…  → { "challengeResponse": sha256(challengeCode + verificationToken + endpoint) } (HTTP 200)
// POST (Benachrichtigung) → { "status": "acknowledged" } (HTTP 200). Hat der gelöschte eBay-Nutzer Angebote im
//      Flip-Radar, wird sein gespeicherter Verkäufername dort sofort entfernt (die App speichert sonst keine eBay-Nutzerdaten).
//
// Umgebungsvariablen:
//   EBAY_VERIFICATION_TOKEN  – selbst gewählter Token (32–80 Zeichen: A–Z, a–z, 0–9, _ und -), identisch im eBay-Developer-Portal eintragen
//   EBAY_ENDPOINT_URL        – optional; muss exakt der im eBay-Portal eingetragenen URL entsprechen
import { createHash } from "node:crypto";
import { getDatabase } from "@netlify/database";

const DEFAULT_ENDPOINT = "https://pokeswipe-radar.de/.netlify/functions/ebay-account-deletion";
const MAX_BODY_BYTES = 64 * 1024;

const json = (status, data) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

const verificationToken = () => String(process.env.EBAY_VERIFICATION_TOKEN || "").trim();
const endpointUrl = () => String(process.env.EBAY_ENDPOINT_URL || "").trim() || DEFAULT_ENDPOINT;

/** SHA-256 (hex) aus challengeCode + verificationToken + endpoint – genau in dieser Reihenfolge, wie eBay es verlangt. */
export function challengeResponse(challengeCode, token, endpoint) {
  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(token);
  hash.update(endpoint);
  return hash.digest("hex");
}

/** Gespeicherte Verkäufernamen des gelöschten eBay-Kontos aus dem Flip-Radar entfernen (Fehler blockieren die Bestätigung nicht). */
async function scrubSeller(username) {
  const name = String(username || "").trim().slice(0, 60);
  if (!name) return 0;
  try {
    const { pool } = getDatabase();
    const res = await pool.query("UPDATE market_offers SET seller = '', seller_feedback_pct = NULL, seller_feedback_score = NULL WHERE seller = $1", [name]);
    return Number(res?.rowCount) || 0;
  } catch (e) {
    console.warn("eBay-Kontolöschung: Bereinigung fehlgeschlagen", e?.message || e);
    return 0;
  }
}

export default async (req) => {
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
    let payload = null;
    try {
      const text = await req.text();
      if (text.length <= MAX_BODY_BYTES) payload = JSON.parse(text);
    } catch {
      payload = null;
    }
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
