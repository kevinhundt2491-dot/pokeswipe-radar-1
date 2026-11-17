// Phase 6: DAC7 / Plattformen-Steuertransparenzgesetz (PStTG) – reine Regeln ohne Datenbank (tests/billing-trust.test.ts)
//
// Meldepflichtig ist ein Verkäufer für ein Kalenderjahr, sofern er NICHT unter die Bagatellgrenze fällt
// (§ 4 Abs. 5 Nr. 4 PStTG: weniger als 30 Verkäufe UND insgesamt nicht mehr als 2.000 € Vergütung).
// Er wird also gemeldet, sobald er 30 Verkäufe erreicht ODER mehr als 2.000 € Vergütung erhalten hat.
// Vergütung = Kaufpreis + Versand (was der Käufer für den Verkauf bezahlt), abzüglich späterer Rückbuchungen;
// die einbehaltenen Provisionen werden getrennt je Quartal gemeldet.

export const DAC7_TX_THRESHOLD = 30;
export const DAC7_GROSS_THRESHOLD_CENTS = 200_000; // 2.000 € – meldepflichtig erst bei MEHR als diesem Betrag
/** Vorwarnung (Phase 10): ab 25 Verkäufen ODER 1.700 € bitten wir rechtzeitig um Steuer-ID und Anschrift. */
export const PSTTG_WARN_TX = 25;
export const PSTTG_WARN_GROSS_CENTS = 170_000; // 1.700 €
/** So viele Erinnerungen bekommt ein meldepflichtiger Verkäufer ohne Steuerdaten, danach wird gesperrt. */
export const DAC7_MAX_REMINDERS = 2;
/** Abstand zwischen zwei Erinnerungen und Frist nach der letzten Erinnerung bis zur Sperre */
export const DAC7_REMINDER_INTERVAL_DAYS = 7;

export type Dac7Stats = {
  transactions: number;
  grossCents: number;
  refundedCents: number;
  feeCents?: number;
};

/** Netto-Vergütung des Jahres (Rückbuchungen/Erstattungen nach Auszahlung abgezogen). */
export const netConsiderationCents = (s: Dac7Stats) => Math.max(0, (Number(s.grossCents) || 0) - (Number(s.refundedCents) || 0));

export function dac7Reportable(s: Dac7Stats): boolean {
  // § 4 Abs. 5 Nr. 4 PStTG: ausgenommen ist nur, wer weniger als 30 Verkäufe UND nicht mehr als 2.000 € Vergütung hat.
  // Genau 2.000,00 € sind also noch NICHT meldepflichtig – erst ab 2.000,01 € (strikt „mehr als“).
  return (Number(s.transactions) || 0) >= DAC7_TX_THRESHOLD || netConsiderationCents(s) > DAC7_GROSS_THRESHOLD_CENTS;
}

/** Vorwarnschwelle erreicht (25 Verkäufe oder 1.700 € netto im Kalenderjahr)? */
export function psttgWarningReached(s: Dac7Stats): boolean {
  return (Number(s.transactions) || 0) >= PSTTG_WARN_TX || netConsiderationCents(s) >= PSTTG_WARN_GROSS_CENTS;
}

export type PsttgStage = "none" | "warning" | "reporting";
/** Stufe für Banner und Export: reporting (ab 30 Verkäufen / mehr als 2.000 €) vor warning (ab 25 / 1.700 €). */
export function psttgStage(s: Dac7Stats): PsttgStage {
  return dac7Reportable(s) ? "reporting" : psttgWarningReached(s) ? "warning" : "none";
}

/**
 * Heuristik „gewerbliches Muster“ (nur Hinweis für die Admin-Prüfung, keine automatische Folge):
 * Ein Konto wirkt gewerblich, wenn mindestens EINES zutrifft –
 *  – ≥ 40 Verkäufe im Kalenderjahr (deutlich über der DAC7-Grenze von 30, typisch für regelmäßigen Handel),
 *  – ≥ 5.000 € Netto-Vergütung im Kalenderjahr,
 *  – ≥ 10 verkaufte Sealed-Produkte (Displays, ETBs, Booster – Ware, die man selten „aus der eigenen Sammlung“ hat),
 *  – derselbe Artikel (gleicher Titel) ≥ 5-mal verkauft (wiederholt identische Inserate = Wiederverkauf),
 *  – ≥ 20 Verkäufe in einem einzelnen Quartal (Verkaufsfrequenz statt gelegentlicher Sammlungsauflösung).
 * Gewerbliche Verkäufer müssen sich als solche kennzeichnen (Verbraucherrechte, § 8a AGB) – Admins sprechen sie an.
 */
export const COMMERCIAL_RULES = { transactions: 40, netCents: 500_000, sealedSales: 10, repeatTitle: 5, quarterTransactions: 20 } as const;

export type CommercialInput = Dac7Stats & { sealedSales?: number; maxRepeatTitle?: number; maxQuarterTransactions?: number };

export function commercialReasons(i: CommercialInput): string[] {
  const r: string[] = [];
  if ((Number(i.transactions) || 0) >= COMMERCIAL_RULES.transactions) r.push(`${i.transactions} Verkäufe im Jahr`);
  if (netConsiderationCents(i) >= COMMERCIAL_RULES.netCents) r.push("Umsatz ab 5.000 €");
  if ((Number(i.sealedSales) || 0) >= COMMERCIAL_RULES.sealedSales) r.push(`${i.sealedSales} Sealed-Produkte`);
  if ((Number(i.maxRepeatTitle) || 0) >= COMMERCIAL_RULES.repeatTitle) r.push(`gleicher Artikel ${i.maxRepeatTitle}× verkauft`);
  if ((Number(i.maxQuarterTransactions) || 0) >= COMMERCIAL_RULES.quarterTransactions) r.push(`${i.maxQuarterTransactions} Verkäufe in einem Quartal`);
  return r;
}
export const commercialPattern = (i: CommercialInput) => commercialReasons(i).length > 0;

/** Quartal (1–4) eines Datums in UTC. */
export const quarterOf = (d: Date) => Math.floor(d.getUTCMonth() / 3) + 1;

// ---------------------------------------------------------------------------
// Erinnern & Sperren
// ---------------------------------------------------------------------------
export type ReminderState = { reportable: boolean; hasTaxInfo: boolean; remindersSent: number; lastReminderAt: Date | null };

/** Soll jetzt eine (weitere) Erinnerung verschickt werden? */
export function dac7ReminderDue(s: ReminderState, now = new Date()): boolean {
  if (!s.reportable || s.hasTaxInfo || s.remindersSent >= DAC7_MAX_REMINDERS) return false;
  if (!s.lastReminderAt) return true;
  return now.getTime() - new Date(s.lastReminderAt).getTime() >= DAC7_REMINDER_INTERVAL_DAYS * 86400_000;
}

/** Gesperrt für neue Treuhand-Verkäufe: meldepflichtig, keine Steuerdaten, 2 Erinnerungen und Frist abgelaufen. */
export function dac7Blocked(s: ReminderState, now = new Date()): boolean {
  if (!s.reportable || s.hasTaxInfo || s.remindersSent < DAC7_MAX_REMINDERS) return false;
  if (!s.lastReminderAt) return true;
  return now.getTime() - new Date(s.lastReminderAt).getTime() >= DAC7_REMINDER_INTERVAL_DAYS * 86400_000;
}

// ---------------------------------------------------------------------------
// Prüfung der Steuerdaten
// ---------------------------------------------------------------------------
/** Deutsche Steuer-Identifikationsnummer: 11 Ziffern, erste nicht 0, Prüfziffer nach ISO 7064 MOD 11,10. */
export function validGermanTin(tin: string): boolean {
  if (!/^[1-9]\d{10}$/.test(tin)) return false;
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let sum = (Number(tin[i]) + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  let check = 11 - product;
  if (check === 10) check = 0;
  return check === Number(tin[10]);
}

/** IBAN-Prüfung (Länderlänge grob, Prüfsumme mod 97 = 1). */
export function validIban(raw: string): boolean {
  const iban = String(raw || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("DE") && iban.length !== 22) return false;
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

export type TaxInfoInput = {
  sellerType?: unknown; legalName?: unknown; street?: unknown; postalCode?: unknown; city?: unknown; country?: unknown;
  birthDate?: unknown; taxId?: unknown; vatId?: unknown; businessRegNo?: unknown; iban?: unknown;
};
export type TaxInfo = {
  sellerType: "individual" | "entity"; legalName: string; street: string; postalCode: string; city: string; country: string;
  birthDate: string | null; taxId: string; vatId: string; businessRegNo: string; iban: string;
};

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Prüft und normalisiert die DAC7-Pflichtangaben. Gibt entweder die bereinigten Daten oder eine deutsche Fehlermeldung zurück. */
export function validateTaxInfo(i: TaxInfoInput, now = new Date()): { ok: true; value: TaxInfo } | { ok: false; error: string; field: string } {
  const sellerType = i.sellerType === "entity" ? "entity" : i.sellerType === "individual" || i.sellerType === undefined ? "individual" : null;
  if (!sellerType) return { ok: false, field: "sellerType", error: "Bitte wähle „Privatperson“ oder „Unternehmen“." };
  const legalName = clean(i.legalName, 160);
  if (legalName.length < 3 || !/\p{L}/u.test(legalName)) return { ok: false, field: "legalName", error: sellerType === "entity" ? "Bitte gib den vollständigen Firmennamen an." : "Bitte gib deinen vollständigen Vor- und Nachnamen an." };
  if (sellerType === "individual" && !/\S+\s+\S+/.test(legalName)) return { ok: false, field: "legalName", error: "Bitte gib Vor- und Nachnamen an." };
  const country = clean(i.country, 2).toUpperCase() || "DE";
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, field: "country", error: "Bitte gib das Land als zweistelligen ISO-Code an (z. B. DE)." };
  const street = clean(i.street, 160);
  if (street.length < 3 || !/\d/.test(street)) return { ok: false, field: "street", error: "Bitte gib Straße und Hausnummer an." };
  const postalCode = clean(i.postalCode, 12).toUpperCase();
  if (country === "DE" ? !/^\d{5}$/.test(postalCode) : !/^[A-Z0-9][A-Z0-9 -]{2,10}$/.test(postalCode)) return { ok: false, field: "postalCode", error: "Bitte gib eine gültige Postleitzahl an." };
  const city = clean(i.city, 80);
  if (city.length < 2) return { ok: false, field: "city", error: "Bitte gib den Ort an." };

  let birthDate: string | null = null;
  const rawBirth = clean(i.birthDate, 10);
  if (sellerType === "individual" || rawBirth) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawBirth);
    const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    if (!m || !d || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
      return { ok: false, field: "birthDate", error: "Bitte gib dein Geburtsdatum an (TT.MM.JJJJ)." };
    }
    const age = (now.getTime() - d.getTime()) / (365.2425 * 86400_000);
    if (age < 18 || age > 120) return { ok: false, field: "birthDate", error: "Verkaufen mit Käuferschutz ist ab 18 Jahren möglich – bitte prüfe das Geburtsdatum." };
    birthDate = rawBirth;
  }

  const taxRaw = clean(i.taxId, 20).toUpperCase();
  let taxId = taxRaw.replace(/[\s/.-]/g, "");
  if (country === "DE") {
    if (sellerType === "individual") {
      if (!validGermanTin(taxId)) return { ok: false, field: "taxId", error: "Die Steuer-Identifikationsnummer ist ungültig (11 Ziffern, siehe Lohnsteuerbescheinigung oder Steuerbescheid)." };
    } else if (!/^\d{10,13}$/.test(taxId) && !/^DE\d{9}$/.test(taxId) && !validGermanTin(taxId)) {
      return { ok: false, field: "taxId", error: "Bitte gib die Steuernummer (10–13 Ziffern) oder Wirtschafts-Identifikationsnummer des Unternehmens an." };
    }
  } else if (!/^[A-Z0-9]{5,20}$/.test(taxId)) {
    return { ok: false, field: "taxId", error: "Bitte gib die Steuer-Identifikationsnummer (TIN) deines Wohnsitzlandes an." };
  }

  const vatId = clean(i.vatId, 16).toUpperCase().replace(/[\s.-]/g, "");
  if (vatId && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(vatId)) return { ok: false, field: "vatId", error: "Die USt-IdNr. ist ungültig (z. B. DE123456789)." };
  if (vatId.startsWith("DE") && !/^DE\d{9}$/.test(vatId)) return { ok: false, field: "vatId", error: "Eine deutsche USt-IdNr. besteht aus DE und 9 Ziffern." };
  const businessRegNo = clean(i.businessRegNo, 40);
  if (sellerType === "entity" && !businessRegNo && !vatId) return { ok: false, field: "businessRegNo", error: "Bitte gib die Handelsregisternummer oder die USt-IdNr. des Unternehmens an." };

  const iban = String(i.iban ?? "").replace(/\s+/g, "").toUpperCase().slice(0, 34);
  if (!validIban(iban)) return { ok: false, field: "iban", error: "Die IBAN ist ungültig – bitte prüfe sie (Prüfsumme stimmt nicht)." };

  return { ok: true, value: { sellerType, legalName, street, postalCode, city, country, birthDate, taxId, vatId, businessRegNo, iban } };
}

/** Sind alle DAC7-Pflichtangaben vorhanden (z. B. für ältere oder manuell angelegte Datensätze)? */
export function taxInfoComplete(t: (Partial<Omit<TaxInfo, "sellerType">> & { sellerType?: string | null }) | null | undefined): boolean {
  if (!t) return false;
  const base = Boolean(t.legalName && t.street && t.postalCode && t.city && t.country && t.taxId && t.iban);
  return base && (t.sellerType === "entity" ? Boolean(t.businessRegNo || t.vatId) : Boolean(t.birthDate));
}

// ---------------------------------------------------------------------------
// CSV für die Vorbereitung der BZSt-Meldung
// ---------------------------------------------------------------------------
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Formel-Injection in Tabellenprogrammen verhindern
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(";");
/** Cent-Betrag im deutschen Format ohne Tausenderpunkt, z. B. 123456 → "1234,56" */
export const csvEuro = (cents: number) => ((Number(cents) || 0) / 100).toFixed(2).replace(".", ",");
