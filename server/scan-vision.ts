// PokeSwipe & Radar – Scanner-Stufe 3: KI-Vision auf dem zugeschnittenen Kartenfoto + fehlertoleranter Katalog-Abgleich.
// Gemini Vision (über das Netlify AI Gateway) liest Name, Sammlernummer, KP, Seltenheit, Illustrator und Variante,
// bei Ausfall übernimmt Claude. Danach werden deutsche Karten (`cards`) und englische/japanische Drucke (`card_prints`)
// per Nummer + Trigramm-Namenssuche gesucht und mit scoreCandidate gewichtet (Top-Treffer + Alternativen).
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { rows } from "./util.ts";
import { log } from "./log.ts";
import { lookup } from "./scan-index.ts";
import {
  VISION_PROMPT, parseVisionResponse, rankCandidates, searchTerms, VISION_CLEAR_MARGIN, VISION_MIN_SCORE, finishToVariant,
  RARITY_CLASS_LABEL, type VisionCard, type CatalogCandidate,
} from "./scan-vision-logic.ts";

export const GEMINI_VISION_MODEL = "gemini-3.5-flash";
export const CLAUDE_VISION_MODEL = "claude-haiku-5-5";
const VISION_TIMEOUT_MS = 9000;

/** Data-URL eines Fotos prüfen (JPG/PNG/WebP, max. ca. 1,5 MB). */
export function parseImageDataUrl(v: unknown): { mime: "image/jpeg" | "image/png" | "image/webp"; b64: string } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ""));
  if (!m || m[2].length > 2_000_000) return null;
  return { mime: m[1] as "image/jpeg", b64: m[2] };
}

async function viaGemini(mime: string, b64: string): Promise<string> {
  const ai = new GoogleGenAI({});
  const r = await ai.models.generateContent({
    model: GEMINI_VISION_MODEL,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: VISION_PROMPT }] }],
    config: {
      responseMimeType: "application/json", temperature: 0, maxOutputTokens: 600,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    },
  });
  return String(r.text || "");
}

async function viaClaude(mime: string, b64: string): Promise<string> {
  const ai = new Anthropic();
  const msg = await ai.messages.create({
    model: CLAUDE_VISION_MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: b64 } },
      { type: "text", text: VISION_PROMPT },
    ] }],
  }, { timeout: VISION_TIMEOUT_MS });
  return msg.content.map((p: any) => (p.type === "text" ? p.text : "")).join("");
}

/**
 * Karte auf dem Foto lesen: zuerst Gemini Vision, bei Fehler/unlesbarer Antwort Claude.
 * Wirft nur, wenn beide Modelle scheitern.
 */
export async function visionIdentify(mime: string, b64: string): Promise<{ card: VisionCard | null; model: string }> {
  let lastErr: unknown = null;
  for (const [model, fn] of [[GEMINI_VISION_MODEL, viaGemini], [CLAUDE_VISION_MODEL, viaClaude]] as const) {
    try {
      const card = parseVisionResponse(await fn(mime, b64));
      if (card) return { card, model };
    } catch (e) {
      lastErr = e;
      log.warn("scan-vision", "Vision-Modell fehlgeschlagen", { model, err: String((e as any)?.message || e).slice(0, 200) });
    }
  }
  if (lastErr) throw lastErr;
  return { card: null, model: "" };
}

/** SQL-Ausdruck: lokale Nummer normiert wie normLocal() ("TG05" → "TG5", "085" → "85"). */
const normLocalSql = (col: any) => sql`regexp_replace(upper(replace(coalesce(${col}, ''), ' ', '')), '^([A-Z]*)0*([0-9])', '\\1\\2')`;

/** Kandidaten aus dem eigenen Katalog (deutsch + englische/japanische Drucke) für einen KI-Fingerabdruck. */
export async function catalogCandidates(det: VisionCard): Promise<CatalogCandidate[]> {
  const terms = searchTerms(det);
  const local = det.local;
  if (!terms.length && !local) return [];
  const t0 = terms[0] || "";
  const nameMatch = (col: any) => (terms.length ? sql.join(terms.map((t) => sql`lower(${col}) % ${t}`), sql` OR `) : sql`false`);
  const simExpr = (col: any) => (terms.length ? sql`greatest(${sql.join(terms.map((t) => sql`similarity(lower(${col}), ${t})`), sql`, `)})` : sql`0`);
  const localCond = (col: any) => (local ? sql`${normLocalSql(col)} = ${local}` : sql`false`);
  const totalNum = Number(String(det.total || "").replace(/^[A-Z]+/, "")) || 0;
  const [de, prints] = await Promise.all([
    db.execute(sql`
      SELECT c.id, c.name, c.local_id, c.set_id, c.set_name, c.rarity, c.illustrator, c.hp, s.abbreviation, s.card_count_official AS total
      FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id
      WHERE (${nameMatch(sql`c.name`)})
         OR (${localCond(sql`c.local_id`)} AND (${t0 ? sql`similarity(lower(c.name), ${t0}) > 0.12` : sql`true`} OR s.card_count_official = ${totalNum}))
      ORDER BY (${localCond(sql`c.local_id`)})::int DESC, ${simExpr(sql`c.name`)} DESC
      LIMIT 60`),
    db.execute(sql`
      SELECT p.id, p.lang, p.name, p.local_id, p.set_id, p.set_name, p.set_code, p.rarity, p.number
      FROM card_prints p
      WHERE (${nameMatch(sql`p.name`)})
         OR (${localCond(sql`p.local_id`)} AND (${t0 ? sql`similarity(lower(p.name), ${t0}) > 0.12` : sql`true`} OR split_part(p.number, '/', 2) = ${String(totalNum || "")}))
      ORDER BY (${localCond(sql`p.local_id`)})::int DESC, ${simExpr(sql`p.name`)} DESC
      LIMIT 60`),
  ]);
  const out: CatalogCandidate[] = [];
  for (const r of rows(de)) {
    out.push({
      key: `card:${r.id}`, lang: "de", name: String(r.name || ""), localId: String(r.local_id || ""), total: r.total ? Number(r.total) : null,
      setCode: String(r.abbreviation || ""), setName: String(r.set_name || ""), setId: String(r.set_id || ""),
      hp: r.hp ? Number(r.hp) : null, rarity: r.rarity ? String(r.rarity) : null, illustrator: r.illustrator ? String(r.illustrator) : null,
    });
  }
  for (const r of rows(prints)) {
    const total = Number(String(r.number || "").split("/")[1]) || null;
    out.push({
      key: `print:${r.id}`, lang: String(r.lang || ""), name: String(r.name || ""), localId: String(r.local_id || ""), total,
      setCode: String(r.set_code || ""), setName: String(r.set_name || ""), setId: String(r.set_id || ""), rarity: r.rarity ? String(r.rarity) : null,
    });
  }
  return out;
}

/** Komplette Stufe 3: KI lesen → Katalog → Top-Treffer mit Marktpreis (Lookup-Format des Live-Scanners). */
export async function visionScan(mime: string, b64: string) {
  const t0 = Date.now();
  const { card: det, model } = await visionIdentify(mime, b64);
  if (!det?.isPokemonCard || (!det.name && !det.local)) {
    return { found: false, detected: det, model, ms: Date.now() - t0, items: [] as any[], clear: false };
  }
  const ranked = rankCandidates(det, await catalogCandidates(det).catch((e) => {
    log.warn("scan-vision", "Katalog-Abgleich fehlgeschlagen", { err: String(e?.message || e).slice(0, 200) });
    return [] as CatalogCandidate[];
  }), 6);
  const infos = ranked.length ? await lookup(ranked.map((r) => r.key)) : [];
  const scoreOf = new Map(ranked.map((r) => [r.key, r.score]));
  const items = infos.map((i) => ({ ...i, matchScore: scoreOf.get(i.key) ?? 0 })).sort((a, b) => b.matchScore - a.matchScore);
  const clear = items.length > 0 && items[0].matchScore >= VISION_MIN_SCORE && (items.length < 2 || items[0].matchScore - items[1].matchScore >= VISION_CLEAR_MARGIN);
  return {
    found: items.length > 0, clear, model, ms: Date.now() - t0,
    detected: { ...det, variant: finishToVariant(det.finish), rarityLabel: RARITY_CLASS_LABEL[det.rarityClass] || "" },
    items,
  };
}
