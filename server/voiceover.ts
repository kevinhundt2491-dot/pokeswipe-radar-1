// Deutsche Sprecherstimme (Voiceover) für die Auto-Reels.
// Admin-only, ausschließlich mit der ElevenLabs-Stimme "Matilda" (weiblich, freundlich & warm).
// /api/admin/voiceover/narration: das komplette Reel-Skript wird in EINEM durchgehenden Take gesprochen
// (natürliche Satzmelodie ohne zusammengestückelte Clips) – inkl. Zeitstempel pro Satz, damit der Client
// die Szenen exakt auf den gesprochenen Text legen kann. Fertige Takes landen in Netlify Blobs,
// damit jedes Skript nur einmal bezahlt wird.
import { getStore } from "@netlify/blobs";
import { rateLimit } from "./util.ts";

const MAX_LINES = 12, MAX_CHARS = 320;
// Feste Sprecherin für alle Reels: Matilda (ElevenLabs-Premade, über eleven_multilingual_v2 auf Hochdeutsch)
export const MATILDA = { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", desc: "weiblich, freundlich & warm" };
export const EL_VOICES = [MATILDA];
const EL_MODEL = "eleven_multilingual_v2";
// Ruhige, natürliche Sprechweise: hohe Stabilität gegen schwankende Betonung, style = 0 (keine
// künstliche Übertreibung), normales Tempo (speed 1.0) – Tempo wird im Client NICHT verändert.
const VOICE_SETTINGS = { stability: 0.6, similarity_boost: 0.78, style: 0, use_speaker_boost: true, speed: 1.0 };
// Erlaubter Tempo-Spielraum (ElevenLabs "speed" ändert das Tempo OHNE die Tonhöhe zu verfälschen).
// Bewusst eng gehalten, damit die Sprecherin immer wie ein normaler Muttersprachler klingt.
export const SPEED_MIN = 0.9, SPEED_MAX = 1.12;
const NARRATION_MAX_CHARS = 900;
// Fester Seed = gleiche Zeile klingt bei jeder Neuerzeugung gleich
const SEED = 20261115;
// Bisheriges Make.com-Szenario als Rückfall, bis MAKE_WEBHOOK_URL in Netlify gesetzt ist.
// Liegt nur auf dem Server und wird ausschließlich an Admins ausgeliefert.
const DEFAULT_MAKE_WEBHOOK = "https://hook.eu1.make.com/pb4ym0nehyg8xdj8l6sobvyr0jwldhkt";

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

/** Komplettes Skript in einem Take sprechen (mit Zeitstempeln pro Zeichen). */
async function narrate(key: string, lines: string[], speed: number): Promise<Narration> {
  const text = lines.join(" ");
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(MATILDA.id)}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "application/json" },
    // Netlify Server muss innerhalb von 20 s antworten
    signal: AbortSignal.timeout(18_000),
    body: JSON.stringify({ text, model_id: EL_MODEL, voice_settings: { ...VOICE_SETTINGS, speed }, seed: SEED }),
  });
  if (!res.ok) {
    const hint = res.status === 401 ? " – API-Schlüssel ungültig" : res.status === 429 ? " – Kontingent/Rate-Limit erreicht" : res.status === 422 ? " – Text oder Stimme abgelehnt" : "";
    throw new Error(`ElevenLabs antwortet mit ${res.status}${hint}`);
  }
  const j: any = await res.json();
  if (!j?.audio_base64) throw new Error("Leere Sprachdatei erhalten");
  const { marks, duration } = marksFromAlignment(lines, j.alignment || j.normalized_alignment);
  return { audio: j.audio_base64, duration, marks, speed };
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString("base64");

export function registerVoiceover(app: any, { auth, adminOnly, body }: any) {
  app.get("/api/admin/voiceover/status", auth, adminOnly, (c: any) => {
    const p = provider();
    c.header("Cache-Control", "no-store");
    const voices = p ? EL_VOICES : [];
    // Make.com-Ziel kommt aus den Netlify-Umgebungsvariablen (nicht mehr fest im öffentlichen Browser-Code)
    const hook = String(process.env.MAKE_WEBHOOK_URL || DEFAULT_MAKE_WEBHOOK).trim();
    let makeUrl: string | null = null;
    try { makeUrl = hook && new URL(hook).protocol === "https:" ? new URL(hook).href : null; } catch { makeUrl = null; }
    const makeToken = String(process.env.MAKE_WEBHOOK_TOKEN || "").trim().slice(0, 200) || null;
    return c.json({ ready: !!p, provider: p?.id.split(":")[0] || null, voices, defaultVoice: p?.voice || null, make: { url: makeUrl, token: makeToken } });
  });

  // Ganzes Reel-Skript als ein durchgehender Take (Matilda) + Zeitstempel je Satz
  app.post("/api/admin/voiceover/narration", auth, adminOnly, async (c: any) => {
    const user = c.get("user");
    if (!rateLimit(`vo:${user.id}`, 40, 60_000)) return c.json({ error: "Zu viele Voiceover-Anfragen – bitte kurz warten." }, 429);
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return c.json({ error: "Kein Sprachdienst eingerichtet (ELEVENLABS_API_KEY fehlt)." }, 503);
    const b = await body(c);
    const lines = (Array.isArray(b.lines) ? b.lines.slice(0, MAX_LINES) : []).map((l: any) => speakable(String(l ?? "")).slice(0, MAX_CHARS));
    if (!lines.length || lines.some((l: string) => !l)) return c.json({ error: "Sprechertext fehlt oder enthält leere Sätze." }, 400);
    if (lines.join(" ").length > NARRATION_MAX_CHARS) return c.json({ error: "Sprechertext zu lang." }, 400);
    const sp = Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(b.speed) || 1)) * 100) / 100;
    const store = getStore("voiceover");
    const id = await sha(`narration:v1|${EL_MODEL}|${MATILDA.id}|${JSON.stringify(VOICE_SETTINGS)}|${sp}|${JSON.stringify(lines)}`);
    try {
      const hit = (await store.get(id, { type: "json" })) as Narration | null;
      if (hit?.audio) return c.json({ ...hit, cached: true });
    } catch { /* Cache optional */ }
    let n: Narration;
    try { n = await narrate(key, lines, sp); }
    catch (e: any) {
      console.error("Voiceover-Fehler", e);
      const msg = e?.name === "TimeoutError" ? "Zeitüberschreitung beim Sprachdienst" : e?.message || "unbekannt";
      return c.json({ error: `Sprachausgabe fehlgeschlagen: ${msg}` }, 502);
    }
    try { await store.setJSON(id, n, { metadata: { voice: MATILDA.id, speed: sp } }); } catch { /* Cache optional */ }
    return c.json({ ...n, cached: false });
  });

  app.post("/api/admin/voiceover", auth, adminOnly, async (c: any) => {
    const user = c.get("user");
    if (!rateLimit(`vo:${user.id}`, 40, 60_000)) return c.json({ error: "Zu viele Voiceover-Anfragen – bitte kurz warten." }, 429);
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
      console.error("Voiceover-Fehler", e);
      const msg = e?.name === "TimeoutError" ? "Zeitüberschreitung beim Sprachdienst" : e?.message || "unbekannt";
      return c.json({ error: `Sprachausgabe fehlgeschlagen: ${msg}` }, 502);
    }
    return c.json({ provider: p.id.split(":")[0], clips: out });
  });
}
