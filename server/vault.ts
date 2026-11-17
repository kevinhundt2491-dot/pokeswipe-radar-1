// Feldverschlüsselung für DAC7-Steuerdaten (Steuer-ID, IBAN, Geburtsdatum) – Schlüsselverwaltung.
//
// • Hauptschlüssel: Server-Umgebungsvariable DATA_ENCRYPTION_KEY (32 Byte als 64 Hex-Zeichen oder Base64,
//   alternativ eine lange Passphrase ab 32 Zeichen). Er liegt getrennt von der Datenbank – ein Datenbank-Abzug
//   allein verrät die Steuerdaten nicht.
// • Sauberer Fallback: Ist DATA_ENCRYPTION_KEY (noch) nicht gesetzt, wird trotzdem verschlüsselt – mit einem
//   zufälligen Notfall-Schlüssel aus Netlify Blobs (Store „app-config“). Sobald DATA_ENCRYPTION_KEY gesetzt ist,
//   werden solche Einträge und unverschlüsselte Alt-Einträge beim nächsten Zugriff (bzw. über den Admin-Knopf
//   „Alt-Einträge verschlüsseln“) automatisch auf den Hauptschlüssel umgeschlüsselt.
// • Klartext verlässt den Server nur beim autorisierten DAC7-Behördenexport (Admin) oder für den Verkäufer selbst.
import { randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { decryptWith, encryptWith, isEncrypted, keyIdOf, parseKey, VaultError, type Keyring } from "./vault-logic.ts";
import { log } from "./log.ts";

const BLOB_KEY_NAME = "vault-fallback-key-v1";
let blobKey: Buffer | null = null;
let warned = false;

function envKey(): Buffer | null {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  const k = parseKey(raw);
  if (!k && raw && !warned) { warned = true; log.error("vault", "DATA_ENCRYPTION_KEY ist ungültig (zu kurz) – es wird der Notfall-Schlüssel verwendet."); }
  return k;
}

/** Ist der dedizierte Hauptschlüssel gesetzt? (Admin-Zentrale / Betriebs-Wächter) */
export const vaultConfigured = () => Boolean(envKey());

async function loadBlobKey(): Promise<Buffer> {
  if (blobKey) return blobKey;
  const store = getStore({ name: "app-config", consistency: "strong" });
  let b64 = await store.get(BLOB_KEY_NAME);
  if (!b64) {
    await store.set(BLOB_KEY_NAME, randomBytes(32).toString("base64"), { onlyIfNew: true });
    b64 = await store.get(BLOB_KEY_NAME);
  }
  const k = Buffer.from(String(b64 || ""), "base64");
  if (k.length !== 32) throw new VaultError("Notfall-Schlüssel ungültig");
  blobKey = k;
  return k;
}

/** Wert für die Datenbank verschlüsseln (leere Werte bleiben leer). */
export async function sealField(plain: string | null | undefined, field: string): Promise<string> {
  const v = String(plain ?? "");
  if (!v) return "";
  const env = envKey();
  if (env) return encryptWith(env, "env", v, field);
  if (!warned) { warned = true; log.warn("vault", "DATA_ENCRYPTION_KEY fehlt – Steuerdaten werden mit dem Notfall-Schlüssel aus Netlify Blobs verschlüsselt."); }
  return encryptWith(await loadBlobKey(), "blob", v, field);
}

/** Wert aus der Datenbank lesen: verschlüsselt → entschlüsseln, Klartext-Alteintrag → unverändert zurückgeben. */
export async function openField(stored: string | null | undefined, field: string): Promise<string> {
  const v = String(stored ?? "");
  if (!isEncrypted(v)) return v;
  const keys: Keyring = {};
  const kid = keyIdOf(v);
  if (kid === "env") { const k = envKey(); if (k) keys.env = k; }
  if (kid === "blob") keys.blob = await loadBlobKey();
  return decryptWith(keys, v, field);
}

/** Muss der gespeicherte Wert (neu) verschlüsselt werden? Klartext immer, Notfall-Schlüssel sobald der Hauptschlüssel da ist. */
export function needsReseal(stored: string | null | undefined): boolean {
  const v = String(stored ?? "");
  if (!v) return false;
  if (!isEncrypted(v)) return true;
  return keyIdOf(v) === "blob" && vaultConfigured();
}

/** Entschlüsseln ohne Ausnahme (für Übersichten): bei Fehler leer + Fehlerkennzeichen. */
export async function openFieldSafe(stored: string | null | undefined, field: string): Promise<{ value: string; error: boolean }> {
  try { return { value: await openField(stored, field), error: false }; }
  catch (e) { log.error("vault", "Feld konnte nicht entschlüsselt werden", { field, err: e }); return { value: "", error: true }; }
}

export { isEncrypted, VaultError };
