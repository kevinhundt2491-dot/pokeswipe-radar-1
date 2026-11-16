// Phase 8: Versandetiketten über die DHL Parcel DE Shipping API v2 mit den eigenen Geschäftskunden-Zugangsdaten
// des Händlers – reine Logik ohne Netzwerk/Datenbank (in tests/shipping-labels.test.ts geprüft).
//
// Abrechnung: Der Händler zahlt das Etikett direkt über seinen DHL-Vertrag (Abrechnungsnummer = EKP + Verfahren +
// Teilnahme). PokeSwipe speichert nur die Zugangsdaten (Passwort verschlüsselt) und das erzeugte PDF.
// API: POST {base}/orders (Etikett), DELETE {base}/orders?shipment=… (Storno), ?validate=true (Probelauf).

export const DHL_BASE = { production: "https://api-eu.dhl.com/parcel/de/shipping/v2", sandbox: "https://api-sandbox.dhl.com/parcel/de/shipping/v2" } as const;
export const DHL_PROFILE = "STANDARD_GRUPPENPROFIL";

/** Produkte (Code → Verfahren für die Abrechnungsnummer, Gewichtsgrenze, Ziel) */
export const DHL_PRODUCTS = {
  V62KP: { label: "DHL Kleinpaket (national)", procedure: "62", maxG: 1000, international: false },
  V01PAK: { label: "DHL Paket (national)", procedure: "01", maxG: 31500, international: false },
  V53WPAK: { label: "DHL Paket International", procedure: "53", maxG: 31500, international: true },
  V66WPI: { label: "DHL Warenpost International", procedure: "66", maxG: 1000, international: true },
} as const;
export type DhlProduct = keyof typeof DHL_PRODUCTS;
export const isDhlProduct = (p: unknown): p is DhlProduct => typeof p === "string" && p in DHL_PRODUCTS;

/** ISO-3166 alpha-2 → alpha-3 für die Lieferländer des Marktplatzes (DHL erwartet alpha-3) */
export const ISO3: Record<string, string> = {
  DE: "DEU", AT: "AUT", CH: "CHE", NL: "NLD", BE: "BEL", LU: "LUX", FR: "FRA", IT: "ITA", ES: "ESP", PL: "POL", DK: "DNK", CZ: "CZE",
};
/** Nicht-EU-Ziele brauchen eine Zollinhaltserklärung – dafür bitte direkt im DHL-Geschäftskundenportal frankieren */
export const CUSTOMS_COUNTRIES = new Set(["CHE"]);

export const PRINT_FORMATS = ["A4", "910-300-700", "910-300-356"] as const;
export type PrintFormat = (typeof PRINT_FORMATS)[number];

const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** „Musterstraße 12a“ → { street: "Musterstraße", house: "12a" }; ohne erkennbare Hausnummer bleibt alles in street. */
export function splitStreet(line: string): { street: string; house: string } {
  const s = clip(line, 120);
  const m = s.match(/^(.*?[^\d\s])\s*,?\s+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/);
  if (m) return { street: m[1].trim(), house: m[2].replace(/\s+/g, "") };
  // Französisch/belgisch: „12 rue de la Paix“
  const f = s.match(/^(\d+\s*[a-zA-Z]?)\s+(.+)$/);
  if (f) return { street: f[2].trim(), house: f[1].replace(/\s+/g, "") };
  return { street: s, house: "" };
}

export type ShippingAccountInput = {
  username?: unknown; password?: unknown; ekp?: unknown; participation?: unknown; sandbox?: unknown;
  senderName?: unknown; senderStreet?: unknown; senderHouse?: unknown; senderZip?: unknown; senderCity?: unknown; senderCountry?: unknown; senderEmail?: unknown;
  defaultProduct?: unknown; defaultWeightG?: unknown;
};

export type ShippingAccountValue = {
  username: string; password: string | null; ekp: string; participation: Partial<Record<DhlProduct, string>>; sandbox: boolean;
  senderName: string; senderStreet: string; senderHouse: string; senderZip: string; senderCity: string; senderCountry: string; senderEmail: string;
  defaultProduct: DhlProduct; defaultWeightG: number;
};

/**
 * Prüft die Händler-Eingaben. password = null bedeutet „unverändert lassen“ (beim Bearbeiten ohne neues Passwort);
 * requirePassword für die Ersteinrichtung.
 */
export function validateShippingAccount(input: ShippingAccountInput, requirePassword: boolean): { ok: true; value: ShippingAccountValue } | { ok: false; error: string } {
  const username = clip(input.username, 80);
  const passwordRaw = typeof input.password === "string" ? input.password.slice(0, 200) : "";
  const ekp = clip(input.ekp, 20).replace(/\s/g, "");
  const senderCountry = clip(input.senderCountry || "DEU", 3).toUpperCase();
  const participation: Partial<Record<DhlProduct, string>> = {};
  const rawPart = input.participation && typeof input.participation === "object" ? input.participation as Record<string, unknown> : {};
  for (const p of Object.keys(DHL_PRODUCTS) as DhlProduct[]) {
    const v = clip(rawPart[p] ?? "01", 2);
    if (!/^\d{2}$/.test(v)) return { ok: false, error: `Teilnahme für ${DHL_PRODUCTS[p].label} muss zweistellig sein (z. B. 01).` };
    participation[p] = v;
  }
  const value: ShippingAccountValue = {
    username, password: passwordRaw ? passwordRaw : null, ekp, participation, sandbox: input.sandbox === true,
    senderName: clip(input.senderName, 50), senderStreet: clip(input.senderStreet, 50), senderHouse: clip(input.senderHouse, 10),
    senderZip: clip(input.senderZip, 10), senderCity: clip(input.senderCity, 40), senderCountry,
    senderEmail: clip(input.senderEmail, 80).toLowerCase(),
    defaultProduct: isDhlProduct(input.defaultProduct) ? input.defaultProduct : "V62KP",
    defaultWeightG: Math.round(Number(input.defaultWeightG) || 500),
  };
  if (!value.username) return { ok: false, error: "Bitte den Benutzernamen des DHL-Geschäftskundenportals angeben." };
  if (requirePassword && !value.password) return { ok: false, error: "Bitte das Passwort des DHL-Geschäftskundenportals angeben." };
  if (!/^\d{10}$/.test(ekp)) return { ok: false, error: "Die EKP (DHL-Kundennummer) hat genau 10 Ziffern." };
  if (value.senderName.length < 2) return { ok: false, error: "Bitte den Absendernamen angeben." };
  if (value.senderStreet.length < 2) return { ok: false, error: "Bitte die Straße des Absenders angeben." };
  if (senderCountry !== "DEU") return { ok: false, error: "DHL Parcel DE versendet nur mit Absender in Deutschland." };
  if (!/^\d{5}$/.test(value.senderZip)) return { ok: false, error: "Bitte eine gültige deutsche Postleitzahl (5 Ziffern) angeben." };
  if (value.senderCity.length < 2) return { ok: false, error: "Bitte den Ort des Absenders angeben." };
  if (value.senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.senderEmail)) return { ok: false, error: "Die E-Mail-Adresse des Absenders ist ungültig." };
  if (value.defaultWeightG < 10 || value.defaultWeightG > 31500) return { ok: false, error: "Standardgewicht zwischen 10 g und 31,5 kg angeben." };
  return { ok: true, value };
}

/** Abrechnungsnummer (14 Stellen) = EKP + Verfahren des Produkts + Teilnahme */
export function billingNumber(ekp: string, product: DhlProduct, participation: Partial<Record<DhlProduct, string>> = {}) {
  return `${ekp}${DHL_PRODUCTS[product].procedure}${participation[product] || "01"}`;
}

export type ShipAddress = { name?: string; line1?: string; line2?: string | null; postal_code?: string; city?: string; country?: string };

/** Empfängeradresse aus der Stripe-Lieferadresse (JSON in market_orders.shipping_address). */
export function consigneeFromAddress(json: string | null | undefined): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  let a: ShipAddress;
  try { a = JSON.parse(String(json || "")); } catch { return { ok: false, error: "Zu dieser Bestellung liegt keine Lieferadresse vor." }; }
  if (!a || typeof a !== "object") return { ok: false, error: "Zu dieser Bestellung liegt keine Lieferadresse vor." };
  const country = ISO3[String(a.country || "").toUpperCase()];
  if (!country) return { ok: false, error: "Für dieses Lieferland kann kein DHL-Etikett erstellt werden." };
  const { street, house } = splitStreet(String(a.line1 || ""));
  const value: Record<string, string> = {
    name1: clip(a.name, 50), addressStreet: clip(street, 50), postalCode: clip(a.postal_code, 10), city: clip(a.city, 40), country,
  };
  if (house) value.addressHouse = clip(house, 10);
  if (a.line2) value.additionalAddressInformation1 = clip(a.line2, 60);
  if (!value.name1 || !value.addressStreet || !value.postalCode || !value.city) return { ok: false, error: "Die Lieferadresse ist unvollständig." };
  return { ok: true, value };
}

/** Wählt bzw. prüft das Produkt passend zum Zielland und Gewicht. */
export function chooseProduct(requested: unknown, destCountry: string, weightG: number, fallback: DhlProduct = "V62KP"): { ok: true; product: DhlProduct } | { ok: false; error: string } {
  const domestic = destCountry === "DEU";
  if (CUSTOMS_COUNTRIES.has(destCountry)) return { ok: false, error: "Für Sendungen in die Schweiz ist eine Zollinhaltserklärung nötig – bitte das Etikett direkt im DHL-Geschäftskundenportal erstellen." };
  let product: DhlProduct = isDhlProduct(requested) ? requested : fallback;
  if (!isDhlProduct(requested)) {
    // Automatisch: national Kleinpaket bis 1 kg, sonst Paket; international Warenpost bis 1 kg, sonst Paket
    product = domestic ? (weightG <= 1000 ? (fallback === "V01PAK" ? "V01PAK" : "V62KP") : "V01PAK") : (weightG <= 1000 ? "V66WPI" : "V53WPAK");
  }
  const def = DHL_PRODUCTS[product];
  if (def.international === domestic) return { ok: false, error: domestic ? "Für Sendungen innerhalb Deutschlands bitte ein nationales Produkt wählen." : "Für Auslandssendungen bitte ein internationales Produkt wählen." };
  if (weightG < 10 || weightG > def.maxG) return { ok: false, error: `${def.label}: Gewicht zwischen 10 g und ${(def.maxG / 1000).toLocaleString("de-DE")} kg.` };
  return { ok: true, product };
}

/** Request-Body für POST /orders */
export function buildShipmentRequest(o: {
  product: DhlProduct; billingNumber: string; refNo: string; weightG: number;
  shipper: { name: string; street: string; house: string; zip: string; city: string; country: string; email?: string };
  consignee: Record<string, string>;
}) {
  const shipper: Record<string, string> = { name1: o.shipper.name, addressStreet: o.shipper.street, postalCode: o.shipper.zip, city: o.shipper.city, country: o.shipper.country };
  if (o.shipper.house) shipper.addressHouse = o.shipper.house;
  if (o.shipper.email) shipper.email = o.shipper.email;
  return {
    profile: DHL_PROFILE,
    shipments: [{
      product: o.product, billingNumber: o.billingNumber, refNo: o.refNo.padEnd(8, "0").slice(0, 35),
      shipper, consignee: o.consignee, details: { weight: { uom: "g", value: Math.round(o.weightG) } },
    }],
  };
}

/** Wertet die DHL-Antwort aus: Sendungsnummer + PDF (Base64) oder eine verständliche Fehlermeldung. */
export function parseShipmentResponse(status: number, json: any): { ok: true; shipmentNo: string; labelB64: string | null; labelUrl: string | null; warnings: string[] } | { ok: false; error: string; status: number } {
  const item = Array.isArray(json?.items) ? json.items[0] : null;
  const messages = (Array.isArray(item?.validationMessages) ? item.validationMessages : [])
    .map((m: any) => clip(`${m?.property ? `${m.property}: ` : ""}${m?.validationMessage || m?.message || ""}`, 200)).filter(Boolean);
  if (status === 401 || status === 403) return { ok: false, status: 401, error: "DHL hat die Zugangsdaten abgelehnt. Bitte Benutzername, Passwort und EKP prüfen." };
  if (status === 429) return { ok: false, status: 429, error: "DHL ist gerade überlastet. Bitte in einer Minute erneut versuchen." };
  if (item?.shipmentNo && (status === 200 || status === 207) && (!item.sstatus || Number(item.sstatus.statusCode) < 400)) {
    return { ok: true, shipmentNo: String(item.shipmentNo), labelB64: item.label?.b64 ? String(item.label.b64) : null, labelUrl: item.label?.url ? String(item.label.url) : null, warnings: messages };
  }
  const detail = messages.length ? messages.slice(0, 3).join(" · ") : clip(item?.sstatus?.detail || json?.status?.detail || json?.detail || json?.title || "", 300);
  return { ok: false, status: status >= 500 ? 502 : 422, error: `DHL hat das Etikett abgelehnt${detail ? `: ${detail}` : "."}` };
}

/** Plausibilität der DHL-Sendungsnummer (Paket: 12–20 Ziffern, international auch mit Buchstaben). */
export const validShipmentNo = (n: string) => /^[A-Z0-9]{10,40}$/i.test(n);
