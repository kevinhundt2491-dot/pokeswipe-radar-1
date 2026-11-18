// Schwarzes Brett / Sammler-Forum, ⚡ Live-Binder-Match & Karten-Pin, Freundschaften, 1:1-Chat und Treffen-Planer –
// reine Logik ohne Datenbank (testbar in tests/social-bulletin.test.ts).

/** Kategorien am Schwarzen Brett: Pulls & Sammler-Flex | Tausch-Gesuche & Angebote | Fragen & Talk. */
export const POST_CATEGORIES = ["pull", "trade", "talk"] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];
export const normalizeCategory = (v: unknown, fallback: PostCategory = "pull"): PostCategory =>
  (POST_CATEGORIES as readonly string[]).includes(String(v)) ? (String(v) as PostCategory) : fallback;

/** Absicht des Karten-Pins: „Ich biete zum Tausch“ (offer) oder „Ich suche für mein Set“ (seek). */
export type CardIntent = "offer" | "seek";
export const normalizeIntent = (v: unknown): CardIntent | null => (v === "offer" || v === "seek" ? v : null);

export type CardPin = {
  cardId: string | null; name: string; setName: string; setId: string | null; localId: string; image: string;
  portfolioItemId: number | null; variant: string; condition: string;
};

const clip = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

/** Speicherbare Karten-Daten (nur bekannte Felder, gekürzt). */
export function cardPinMeta(p: Partial<CardPin>): CardPin {
  const pid = Number(p.portfolioItemId);
  return {
    cardId: p.cardId ? clip(p.cardId, 60) : null,
    name: clip(p.name, 120) || "Karte",
    setName: clip(p.setName, 80),
    setId: p.setId ? clip(p.setId, 40) : null,
    localId: clip(p.localId, 20),
    image: /^(https:\/\/|\/api\/images\/)/.test(String(p.image || "")) ? clip(p.image, 400) : "",
    portfolioItemId: Number.isInteger(pid) && pid > 0 ? pid : null,
    variant: clip(p.variant, 30) || "normal",
    condition: clip(p.condition, 10) || "NM",
  };
}

/** Was der Betrachter über seine Sammlung weiß – nur für die Karten der gerade geladenen Beiträge. */
export type ViewerBinder = {
  qty: Map<string, number>; // card_id → Stückzahl in der Sammlung
  wishlist: Set<string>; // card_id auf der Wunschliste
  sets: Set<string>; // Sets, die der Betrachter sammelt (mind. eine Karte oder verfolgt)
};

export type RadarMatch = { kind: "have" | "seek"; label: string } | null;

/**
 * ⚡ PokeSwipe-Match:
 *  • Beitrag „Ich suche“ → der Betrachter hat genau diese Karte doppelt (≥ 2) im Binder → „Du hast diese Karte“
 *  • Beitrag „Ich biete“ → der Betrachter sucht sie (Wunschliste) oder sie fehlt (grau) in einem Set, das er sammelt → „Du suchst diese Karte“
 */
export function radarMatch(pin: { intent: CardIntent | null; cardId: string | null; setId: string | null }, viewer: ViewerBinder | null, own = false): RadarMatch {
  if (!viewer || own || !pin.intent || !pin.cardId) return null;
  const have = viewer.qty.get(pin.cardId) || 0;
  if (pin.intent === "seek" && have >= 2) return { kind: "have", label: `Du hast diese Karte ${have}× im Binder` };
  if (pin.intent === "offer" && have === 0) {
    if (viewer.wishlist.has(pin.cardId)) return { kind: "seek", label: "Du suchst diese Karte (Wunschliste)" };
    if (pin.setId && viewer.sets.has(pin.setId)) return { kind: "seek", label: "Du suchst diese Karte für dein Set" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Freundschaften
// ---------------------------------------------------------------------------
export type FriendState = "none" | "pending_out" | "pending_in" | "friends";
export function friendState(row: { requesterId: string; addresseeId: string; status: string } | null | undefined, me: string): FriendState {
  if (!row || row.status === "declined") return "none";
  if (row.status === "accepted") return "friends";
  return row.requesterId === me ? "pending_out" : "pending_in";
}

// ---------------------------------------------------------------------------
// Treffen-Planer (Cardshow, Flohmarkt, lokaler Treffpunkt)
// ---------------------------------------------------------------------------
export const MEETUP_KINDS: Record<string, string> = { cardshow: "🎪 Cardshow", flohmarkt: "🛍️ Flohmarkt", local: "📍 Lokaler Treffpunkt", other: "🤝 Treffen" };
export type Meetup = { place: string; kind: string; date: string; time: string; note: string; status: "proposed" | "accepted" | "countered" | "declined" };

/** Prüft einen Treffen-Vorschlag: Ort, Datum (heute bis +1 Jahr), Uhrzeit HH:MM. */
export function parseMeetup(b: Record<string, unknown>, now = new Date()): Meetup | { error: string } {
  const place = clip(b.place, 120);
  if (place.length < 3) return { error: "Bitte einen Ort bzw. ein Event angeben (z. B. Cardshow Köln, Flohmarkt Hauptbahnhof)." };
  const date = clip(b.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Bitte ein gültiges Datum wählen." };
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) return { error: "Bitte ein gültiges Datum wählen." };
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  if (d.getTime() < today) return { error: "Das Datum liegt in der Vergangenheit." };
  if (d.getTime() > today + 366 * 86400_000) return { error: "Bitte ein Datum innerhalb der nächsten 12 Monate wählen." };
  const time = clip(b.time, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: "Bitte eine Uhrzeit wählen (HH:MM)." };
  const kind = Object.prototype.hasOwnProperty.call(MEETUP_KINDS, String(b.kind)) ? String(b.kind) : "local";
  return { place, kind, date, time, note: clip(b.note, 200), status: "proposed" };
}

export function meetupText(m: Pick<Meetup, "place" | "kind" | "date" | "time">) {
  const [y, mo, d] = m.date.split("-");
  return `${MEETUP_KINDS[m.kind] || MEETUP_KINDS.other}: ${m.place} am ${d}.${mo}.${y} um ${m.time} Uhr`;
}
