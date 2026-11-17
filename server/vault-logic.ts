// Feldverschlüsselung für besonders schützenswerte Verkäuferdaten (DAC7: Steuer-ID, IBAN, Geburtsdatum).
// Reine Logik ohne Datenbank/Blobs (tests/vault.test.ts).
//
// Format eines verschlüsselten Werts:  enc:v1:<kid>:<iv b64>:<tag b64>:<daten b64>
//   • AES-256-GCM, 12-Byte-IV pro Wert, 16-Byte-Auth-Tag (Manipulation wird beim Entschlüsseln erkannt)
//   • kid = Schlüssel-Kennung: „env“ (DATA_ENCRYPTION_KEY) oder „blob“ (Notfall-Schlüssel aus Netlify Blobs)
//   • Werte ohne Präfix sind Alt-Einträge im Klartext; sie werden gelesen und beim nächsten Zugriff verschlüsselt.
//   • Zusätzliche Bindung (AAD) an den Feldnamen: ein verschlüsselter IBAN-Wert lässt sich nicht als Steuer-ID ausgeben.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const ENC_PREFIX = "enc:v1:";
export type KeyId = "env" | "blob";
export type Keyring = Partial<Record<KeyId, Buffer>>;

/** Ist der Wert bereits verschlüsselt? */
export const isEncrypted = (v: unknown) => typeof v === "string" && v.startsWith(ENC_PREFIX);

/**
 * Schlüssel aus der Umgebungsvariable ableiten. Akzeptiert 64 Hex-Zeichen oder Base64 (je 32 Byte) direkt;
 * jede andere Zeichenkette ab 32 Zeichen wird per SHA-256 zu 32 Byte verdichtet. Kürzere Werte gelten als ungültig.
 */
export function parseKey(raw: string | undefined | null): Buffer | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, "hex");
  if (/^[A-Za-z0-9+/_-]{43,44}={0,2}$/.test(s)) {
    const b = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (b.length === 32) return b;
  }
  if (s.length < 32) return null;
  return createHash("sha256").update(`pokeswipe-vault:${s}`).digest();
}

export function encryptWith(key: Buffer, kid: KeyId, plain: string, field: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(field, "utf8"));
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${ENC_PREFIX}${kid}:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

/** Schlüssel-Kennung eines verschlüsselten Werts (oder null bei Klartext/Fehlformat). */
export function keyIdOf(v: string): KeyId | null {
  if (!isEncrypted(v)) return null;
  const kid = v.slice(ENC_PREFIX.length).split(":")[0];
  return kid === "env" || kid === "blob" ? kid : null;
}

export class VaultError extends Error {}

export function decryptWith(keys: Keyring, token: string, field: string): string {
  const [kid, iv, tag, data] = token.slice(ENC_PREFIX.length).split(":");
  const key = keys[kid as KeyId];
  if (!key) throw new VaultError(`Schlüssel „${kid}“ nicht verfügbar`);
  if (!iv || !tag || data === undefined) throw new VaultError("Ungültiges Format");
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    d.setAAD(Buffer.from(field, "utf8"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    throw new VaultError("Entschlüsselung fehlgeschlagen (falscher Schlüssel oder manipulierte Daten)");
  }
}

// ---------------------------------------------------------------------------
// Maskierung für Admin-Ansichten und Exporte
// ---------------------------------------------------------------------------
const BULLET = "•";

/** IBAN: Land + Prüfziffer und letzte 4 Stellen sichtbar, z. B. „DE89 •••• •••• 1234“. */
export function maskIban(v: string | null | undefined): string {
  const s = String(v ?? "").replace(/\s+/g, "").toUpperCase();
  if (!s) return "";
  if (s.length < 8) return `${BULLET.repeat(4)}`;
  return `${s.slice(0, 4)} ${BULLET.repeat(4)} ${BULLET.repeat(4)} ${s.slice(-4)}`;
}

/** Steuer-ID: nur die letzten 3 Stellen, z. B. „•••• •••• 123“. */
export function maskTaxId(v: string | null | undefined): string {
  const s = String(v ?? "").replace(/\s+/g, "");
  if (!s) return "";
  if (s.length <= 4) return BULLET.repeat(4);
  return `${BULLET.repeat(4)} ${BULLET.repeat(4)} ${s.slice(-3)}`;
}

/** Geburtsdatum (JJJJ-MM-TT): nur das Jahr, z. B. „••.••.1990“. */
export function maskBirthDate(v: string | null | undefined): string {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(v ?? "").trim());
  if (m) return `${BULLET.repeat(2)}.${BULLET.repeat(2)}.${m[1]}`;
  return v ? `${BULLET.repeat(2)}.${BULLET.repeat(2)}.${BULLET.repeat(4)}` : "";
}
