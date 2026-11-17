// Deutsche Sprecherstimme (Voiceover) für die Auto-Reels.
// Admin-only, ausschließlich mit der ElevenLabs-Stimme "Matilda" (weiblich, freundlich & warm).
// /api/admin/voiceover/narration: das komplette Reel-Skript wird in EINEM durchgehenden Take gesprochen
// (natürliche Satzmelodie ohne zusammengestückelte Clips) – inkl. Zeitstempel pro Satz, damit der Client
// die Szenen exakt auf den gesprochenen Text legen kann. Fertige Takes landen in Netlify Blobs,
// damit jedes Skript nur einmal bezahlt wird.
import { getStore } from "@netlify/blobs";
import { rateLimit } from "./util.ts";
import { log } from "./log.ts";
import { makeConfig, videoConfig } from "./make.ts";
import { rotationAt } from "./reel-video-logic.ts";

const MAX_LINES = 12, MAX_CHARS = 320;
// Feste Sprecherin für alle Reels: Matilda (ElevenLabs-Premade, über eleven_multilingual_v2 auf Hochdeutsch)
export const MATILDA = { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", desc: "weiblich, freundlich & warm" };
export const EL_VOICES = [MATILDA];
const EL_MODEL = "eleven_multilingual_v2";
// Ruhige, natürliche Sprechweise: hohe Stabilität gegen schwankende Betonung, style = 0 (keine
// künstliche Übertreibung), normales Tempo (speed 1.0) – Tempo wird im Client NICHT verändert.
const VOICE_SETTINGS = { stability: 0.6, similarity_boost: 0.78, style: 0, use_speaker_boost: true, speed: 1.0 };
// Pro-Videos: begeistertes Storytelling – mehr Ausdruck (style) und lebendigere Betonung (niedrigere Stabilität),
// Tonhöhe und Klang der Stimme bleiben gleich.
const ENERGETIC_SETTINGS = { stability: 0.36, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true, speed: 1.0 };
export type Tone = "calm" | "energetic";
export const toneSettings = (tone: unknown) => (tone === "energetic" ? ENERGETIC_SETTINGS : VOICE_SETTINGS);
// Erlaubter Tempo-Spielraum (ElevenLabs "speed" ändert das Tempo OHNE die Tonhöhe zu verfälschen).
// Bewusst eng gehalten, damit die Sprecherin immer wie ein normaler Muttersprachler klingt.
export const SPEED_MIN = 0.9, SPEED_MAX = 1.12;
const NARRATION_MAX_CHARS = 900;
// Ein 30-s-Take mit Zeitstempeln kann bei ElevenLabs deutlich länger als 20 s dauern
const NARRATION_TIMEOUT_MS = 75_000;
// Wortlimit der Live-Reels: 32–36 Wörter (15 s) bzw. 65–72 Wörter (30 s) – mehr wird nicht gesprochen,
// damit die Stimme entspannt und vollständig bis zum letzten Wort durchspricht.
export const NARRATION_MAX_WORDS = 72;
/** Wörter wie gesprochen: alles mit Buchstabe oder Ziffer zählt (gleiche Regel wie client/reel-scripts.js). */
export function countWords(text: string | string[]) {
  const s = Array.isArray(text) ? text.join(" ") : String(text ?? "");
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
// Fester Seed = gleiche Zeile klingt bei jeder Neuerzeugung gleich
const SEED = 20261115;
// Bisheriges Make.com-Szenario als Rückfall, bis MAKE_WEBHOOK_URL in Netlify gesetzt ist.
// Liegt nur auf dem Server und wird ausschließlich an Admins ausgeliefert.

type Ctx = { prev?: string; next?: string };
type Provider = { id: string; voice: string; tts: (text: string, ctx?: Ctx) => Promise<ArrayBuffer> };

/**
 * Text für die Sprachausgabe glätten: Emojis, Symbole und Gedankenstriche erzeugen bei TTS
 * merkwürdige Pausen oder Betonungen – sie werden in normale deutsche Satzzeichen/Wörter übersetzt.
 */
export function speakable(text: string) {
  return String(text)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s*&\s*/g, " und ")
    .replace(/(\d)\s*%/g, "$1 Prozent")
    .replace(/(\d)\s*€/g, "$1 Euro")
    .replace(/\s+[–—]\s+/g, ", ")
    .replace(/[„“”"«»]/g, "")
    .replace(/!+/g, ".")
    .replace(/\s+([,.?])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function provider(): Provider | null {
  const el = process.env.ELEVENLABS_API_KEY;
  if (!el) return null;
  const voice = MATILDA.id;
  return {
    id: `elevenlabs:${EL_MODEL}:v3-natural`, voice,
    async tts(text, ctx = {}) {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": el, "Content-Type": "application/json", Accept: "audio/mpeg" },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          text, model_id: EL_MODEL, voice_settings: VOICE_SETTINGS, seed: SEED,
          // Nachbarsätze geben der Stimme den Satzzusammenhang → natürliche, durchgehende Intonation
          ...(ctx.prev ? { previous_text: ctx.prev } : {}),
          ...(ctx.next ? { next_text: ctx.next } : {}),
        }),
      });
      if (!res.ok) {
        const hint = res.status === 401 ? " – API-Schlüssel ungültig" : res.status === 429 ? " – Kontingent/Rate-Limit erreicht" : res.status === 422 ? " – Text oder Stimme abgelehnt" : "";
        throw new Error(`ElevenLabs antwortet mit ${res.status}${hint}`);
      }
      return res.arrayBuffer();
    },
  };
}

type Mark = { start: number; end: number };
type Narration = { audio: string; duration: number; marks: Mark[]; speed: number };

/**
 * Satz-Zeitstempel aus dem ElevenLabs-Alignment ableiten. offsets = Startindex jedes Satzes im Gesamttext.
 * Fällt auf eine Verteilung nach Zeichenanzahl zurück, falls das Alignment nicht zum Text passt.
 */
export function marksFromAlignment(lines: string[], al: any): { marks: Mark[]; duration: number } {
  const text = lines.join(" ");
  const starts: number[] = al?.character_start_times_seconds || [];
  const ends: number[] = al?.character_end_times_seconds || [];
  const duration = Number(ends[ends.length - 1]) || 0;
  const offsets: number[] = [];
  let pos = 0;
  for (const l of lines) { offsets.push(pos); pos += l.length + 1; }
  if (Array.isArray(al?.characters) && al.characters.length === text.length && starts.length === text.length) {
    const marks = lines.map((l, i) => ({ start: Number(starts[offsets[i]]) || 0, end: Number(ends[offsets[i] + l.length - 1]) || 0 }));
    if (marks.every((m, i) => m.end >= m.start && (i === 0 || m.start >= marks[i - 1].start))) return { marks, duration };
  }
  const total = text.length || 1;
  return { duration, marks: lines.map((l, i) => ({ start: (offsets[i] / total) * duration, end: ((offsets[i] + l.length) / total) * duration })) };
}

/** Fehlertext von ElevenLabs lesbar machen (z. B. "quota_exceeded" statt nur "401"). */
async function elevenError(res: Response) {
  let detail = "";
  try {
    const raw = await res.text();
    try {
      const j: any = JSON.parse(raw);
      const d = j?.detail ?? j;
      detail = typeof d === "string" ? d : [d?.status, d?.message].filter(Boolean).join(": ");
    } catch { detail = raw; }
  } catch { /* ohne Details */ }
  detail = String(detail || "").replace(/\s+/g, " ").trim().slice(0, 240);
  const quota = /quota|credits|limit/i.test(detail);
  const hint = quota ? " – ElevenLabs-Kontingent aufgebraucht (Zeichen/Credits im ElevenLabs-Konto aufladen)"
    : res.status === 401 ? " – API-Schlüssel ungültig oder ohne Berechtigung für Text-to-Speech"
    : res.status === 429 ? " – Rate-Limit/zu viele gleichzeitige Anfragen"
    : res.status === 422 ? " – Text oder Stimme abgelehnt" : "";
  const err: any = new Error(`ElevenLabs antwortet mit ${res.status}${hint}${detail ? ` (${detail})` : ""}`);
  err.retry = !quota && (res.status === 429 || res.status >= 500);
  return err;
}

/** Komplettes Skript in einem Take sprechen (mit Zeitstempeln pro Zeichen). */
async function narrate(key: string, lines: string[], speed: number, settings = VOICE_SETTINGS): Promise<Narration> {
  const text = lines.join(" ");
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(MATILDA.id)}/with-timestamps?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
        // Die Antwort an den Browser wird gestreamt (siehe Route) – daher darf ein langer 30-s-Take länger dauern
        signal: AbortSignal.timeout(NARRATION_TIMEOUT_MS),
        body: JSON.stringify({ text, model_id: EL_MODEL, voice_settings: { ...settings, speed }, seed: SEED }),
      });
      if (!res.ok) throw await elevenError(res);
      const j: any = await res.json();
      if (!j?.audio_base64) throw new Error("Leere Sprachdatei erhalten");
      const { marks, duration } = marksFromAlignment(lines, j.alignment || j.normalized_alignment);
      return { audio: j.audio_base64, duration, marks, speed };
    } catch (e: any) {
      const transient = e?.retry || e?.name === "TypeError"; // TypeError = Netzwerkfehler von fetch
      if (attempt >= 2 || !transient) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64");

/** Make.com-Ziel für den Generator: Admin-Zentrale → MAKE_WEBHOOK_URL/MAKE_WEBHOOK_TOKEN → Alt-Wert. */
async function makeForGenerator() {
  try {
    const m = await makeConfig();
    const video = await videoConfig();
    return { url: m.url, token: m.token, platforms: m.platforms, source: m.urlSource, updatedAt: m.updatedAt, video, next: rotationAt(video) };
  } catch { return { url: null, token: null, platforms: [], source: null, updatedAt: null, video: null, next: null }; }
}

/** Verbleibende ElevenLabs-Credits (best effort – null, wenn der Schlüssel das Konto nicht lesen darf). */
async function elevenCredits(key: string) {
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const limit = Number(j?.character_limit), used = Number(j?.character_count);
    if (!Number.isFinite(limit) || !Number.isFinite(used)) return null;
    const reset = Number(j?.next_character_count_reset_unix);
    return { limit, used, remaining: Math.max(0, limit - used), resetAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null, tier: j?.tier ? String(j.tier).slice(0, 40) : null };
  } catch { return null; }
}

export function registerVoiceover(app: any, { auth, adminOnly, body }: any) {
  app.get("/api/admin/voiceover/status", auth, adminOnly, async (c: any) => {
    const p = provider();
    c.header("Cache-Control", "no-store");
    const voices = p ? EL_VOICES : [];
    const [make, credits] = await Promise.all([makeForGenerator(), p ? elevenCredits(process.env.ELEVENLABS_API_KEY as string) : null]);
    return c.json({ ready: !!p, provider: p?.id.split(":")[0] || null, voices, defaultVoice: p?.voice || null, credits, make });
  });

  // Ganzes Reel-Skript als ein durchgehender Take (Matilda) + Zeitstempel je Satz
  app.post("/api/admin/voiceover/narration", auth, adminOnly, async (c: any) => {
    const user = c.get("user");
    if (!(await rateLimit(`vo:${user.id}`, 40, 60_000))) return c.json({ error: "Zu viele Voiceover-Anfragen – bitte kurz warten." }, 429);
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return c.json({ error: "Kein Sprachdienst eingerichtet (ELEVENLABS_API_KEY fehlt)." }, 503);
    const b = await body(c);
    const lines = (Array.isArray(b.lines) ? b.lines.slice(0, MAX_LINES) : []).map((l: any) => speakable(String(l ?? "")).slice(0, MAX_CHARS));
    if (!lines.length || lines.some((l: string) => !l)) return c.json({ error: "Sprechertext fehlt oder enthält leere Sätze." }, 400);
    if (lines.join(" ").length > NARRATION_MAX_CHARS) return c.json({ error: "Sprechertext zu lang." }, 400);
    const words = countWords(lines);
    if (words > NARRATION_MAX_WORDS) return c.json({ error: `Sprechertext zu lang (${words} Wörter, höchstens ${NARRATION_MAX_WORDS}).` }, 400);
    const sp = Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(b.speed) || 1)) * 100) / 100;
    const store = getStore("voiceover");
    const settings = toneSettings(b.tone);
    const id = await sha(`narration:v1|${EL_MODEL}|${MATILDA.id}|${JSON.stringify(settings)}|${sp}|${JSON.stringify(lines)}`);
    try {
      const hit = (await store.get(id, { type: "json" })) as Narration | null;
      if (hit?.audio) return c.json({ ...hit, cached: true });
    } catch { /* Cache optional */ }
    // Netlify Server muss Status + Header innerhalb von 20 s senden: deshalb sofort 200 schicken und die
    // eigentliche JSON-Antwort nachliefern (führende Leerzeichen halten die Verbindung offen, JSON bleibt gültig).
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(ctrl) {
        const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(" ")); } catch { /* geschlossen */ } }, 5000);
        ctrl.enqueue(enc.encode(" "));
        let out: any;
        try {
          const n = await narrate(key, lines, sp, settings);
          try { await store.setJSON(id, n, { metadata: { voice: MATILDA.id, speed: sp } }); } catch { /* Cache optional */ }
          out = { ...n, cached: false };
        } catch (e: any) {
          log.error("voiceover", "Voiceover-Fehler", { err: e });
          const msg = e?.name === "TimeoutError" ? "Zeitüberschreitung beim Sprachdienst (ElevenLabs hat nicht rechtzeitig geantwortet)" : e?.message || "unbekannt";
          out = { error: `Sprachausgabe fehlgeschlagen: ${msg}` };
        } finally { clearInterval(ping); }
        ctrl.enqueue(enc.encode(JSON.stringify(out)));
        ctrl.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  });

  app.post("/api/admin/voiceover", auth, adminOnly, async (c: any) => {
    const user = c.get("user");
    if (!(await rateLimit(`vo:${user.id}`, 40, 60_000))) return c.json({ error: "Zu viele Voiceover-Anfragen – bitte kurz warten." }, 429);
    const b = await body(c);
    const p = provider();
    if (!p) return c.json({ error: "Kein Sprachdienst eingerichtet (ELEVENLABS_API_KEY fehlt)." }, 503);
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, MAX_LINES) : [];
    const clean = lines
      .map((l: any) => ({
        id: String(l?.id ?? "").slice(0, 40),
        text: speakable(String(l?.text ?? "")).slice(0, MAX_CHARS),
        prev: speakable(String(l?.prev ?? "")).slice(0, MAX_CHARS),
        next: speakable(String(l?.next ?? "")).slice(0, MAX_CHARS),
      }))
      .filter((l: any) => l.id && l.text);
    if (!clean.length) return c.json({ error: "Kein Sprechertext übergeben." }, 400);

    const store = getStore("voiceover");
    const out: { id: string; audio: string; cached: boolean }[] = new Array(clean.length);
    // höchstens 2 parallele TTS-Aufrufe (ElevenLabs-Concurrency-Limit)
    let next = 0;
    const worker = async () => {
      while (next < clean.length) {
        const i = next++, { id, text, prev, next: nextText } = clean[i];
        const key = await sha(`${p.id}|${p.voice}|${JSON.stringify(VOICE_SETTINGS)}|${prev}|${text}|${nextText}`);
        let buf: ArrayBuffer | null = null;
        try { buf = (await store.get(key, { type: "arrayBuffer" })) as ArrayBuffer | null; } catch { buf = null; }
        const cached = !!buf;
        if (!buf) {
          buf = await p.tts(text, { prev, next: nextText });
          if (!buf.byteLength) throw new Error("Leere Sprachdatei erhalten");
          try { await store.set(key, buf, { metadata: { provider: p.id, voice: p.voice, text } }); } catch { /* Cache optional */ }
        }
        out[i] = { id, audio: b64(buf), cached };
      }
    };
    try {
      await Promise.all([worker(), worker()]);
    } catch (e: any) {
      log.error("voiceover", "Voiceover-Fehler", { err: e });
      const msg = e?.name === "TimeoutError" ? "Zeitüberschreitung beim Sprachdienst" : e?.message || "unbekannt";
      return c.json({ error: `Sprachausgabe fehlgeschlagen: ${msg}` }, 502);
    }
    return c.json({ provider: p.id.split(":")[0], clips: out });
  });
}
