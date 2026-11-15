// Deutsche Sprecherstimme (Voiceover) für die Auto-Reels.
// Admin-only: erzeugt pro Szenen-Satz eine MP3 über ElevenLabs (bevorzugt, ELEVENLABS_API_KEY)
// oder alternativ OpenAI TTS (OPENAI_TTS_API_KEY). Fertige Clips landen in Netlify Blobs,
// damit jede Zeile nur einmal bezahlt wird – weitere Aufnahmen holen sie aus dem Cache.
import { getStore } from "@netlify/blobs";
import { rateLimit } from "./util.ts";

const MAX_LINES = 12, MAX_CHARS = 320;
// Auswählbare ElevenLabs-Stimmen (Premade, funktionieren mit eleven_multilingual_v2 auch auf Deutsch).
// Standard ist "Brian"; per ELEVENLABS_VOICE_ID kann eine eigene Stimme als Standard gesetzt werden.
export const EL_VOICES = [
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", desc: "männlich, tief & ruhig – Erzähler" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", desc: "männlich, warm & sympathisch" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", desc: "männlich, klar – Nachrichtensprecher" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", desc: "weiblich, jung & lebhaft" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda", desc: "weiblich, freundlich & warm" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", desc: "weiblich, sanft & klar" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", desc: "weiblich – bisherige Stimme" },
];
const DEFAULT_EL_VOICE = "nPczCjzI2devNBz1zQrb";
const EL_MODEL = "eleven_multilingual_v2";
// Bisheriges Make.com-Szenario als Rückfall, bis MAKE_WEBHOOK_URL in Netlify gesetzt ist.
// Liegt nur auf dem Server und wird ausschließlich an Admins ausgeliefert.
const DEFAULT_MAKE_WEBHOOK = "https://hook.eu1.make.com/pb4ym0nehyg8xdj8l6sobvyr0jwldhkt";

type Provider = { id: string; voice: string; tts: (text: string) => Promise<ArrayBuffer> };

function provider(requested?: string): Provider | null {
  const el = process.env.ELEVENLABS_API_KEY;
  if (el) {
    const custom = process.env.ELEVENLABS_VOICE_ID;
    const allowed = requested && (EL_VOICES.some((v) => v.id === requested) || requested === custom);
    const voice = allowed ? requested! : custom || DEFAULT_EL_VOICE;
    return {
      id: `elevenlabs:${EL_MODEL}:v2`, voice,
      async tts(text) {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { "xi-api-key": el, "Content-Type": "application/json", Accept: "audio/mpeg" },
          signal: AbortSignal.timeout(45_000),
          body: JSON.stringify({
            text, model_id: EL_MODEL,
            voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.05 },
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
  const oa = process.env.OPENAI_TTS_API_KEY;
  if (oa) {
    const voice = process.env.OPENAI_TTS_VOICE || "nova";
    return {
      id: "openai:gpt-4o-mini-tts", voice,
      async tts(text) {
        const res = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${oa}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(45_000),
          body: JSON.stringify({
            model: "gpt-4o-mini-tts", voice, input: text, response_format: "mp3",
            instructions: "Sprich natürliches Hochdeutsch: freundlich, warm, motiviert und klar – wie ein sympathischer Erklär-Sprecher in einem Social-Media-Reel. Zügiges, aber gut verständliches Tempo.",
          }),
        });
        if (!res.ok) throw new Error(`OpenAI TTS antwortet mit ${res.status}`);
        return res.arrayBuffer();
      },
    };
  }
  return null;
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
    const isEl = p?.id.startsWith("elevenlabs");
    const custom = process.env.ELEVENLABS_VOICE_ID;
    const voices = isEl
      ? [...(custom && !EL_VOICES.some((v) => v.id === custom) ? [{ id: custom, name: "Eigene Stimme", desc: "aus ELEVENLABS_VOICE_ID" }] : []), ...EL_VOICES]
      : [];
    // Make.com-Ziel kommt aus den Netlify-Umgebungsvariablen (nicht mehr fest im öffentlichen Browser-Code)
    const hook = String(process.env.MAKE_WEBHOOK_URL || DEFAULT_MAKE_WEBHOOK).trim();
    let makeUrl: string | null = null;
    try { makeUrl = hook && new URL(hook).protocol === "https:" ? new URL(hook).href : null; } catch { makeUrl = null; }
    const makeToken = String(process.env.MAKE_WEBHOOK_TOKEN || "").trim().slice(0, 200) || null;
    return c.json({ ready: !!p, provider: p?.id.split(":")[0] || null, voices, defaultVoice: p?.voice || null, make: { url: makeUrl, token: makeToken } });
  });

  app.post("/api/admin/voiceover", auth, adminOnly, async (c: any) => {
    const user = c.get("user");
    if (!rateLimit(`vo:${user.id}`, 40, 60_000)) return c.json({ error: "Zu viele Voiceover-Anfragen – bitte kurz warten." }, 429);
    const b = await body(c);
    const p = provider(typeof b.voice === "string" ? b.voice : undefined);
    if (!p) return c.json({ error: "Kein Sprachdienst eingerichtet (ELEVENLABS_API_KEY fehlt)." }, 503);
    const lines = Array.isArray(b.lines) ? b.lines.slice(0, MAX_LINES) : [];
    const clean = lines
      .map((l: any) => ({ id: String(l?.id ?? "").slice(0, 40), text: String(l?.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS) }))
      .filter((l: any) => l.id && l.text);
    if (!clean.length) return c.json({ error: "Kein Sprechertext übergeben." }, 400);

    const store = getStore("voiceover");
    const out: { id: string; audio: string; cached: boolean }[] = new Array(clean.length);
    // höchstens 2 parallele TTS-Aufrufe (ElevenLabs-Concurrency-Limit)
    let next = 0;
    const worker = async () => {
      while (next < clean.length) {
        const i = next++, { id, text } = clean[i];
        const key = await sha(`${p.id}|${p.voice}|${text}`);
        let buf: ArrayBuffer | null = null;
        try { buf = (await store.get(key, { type: "arrayBuffer" })) as ArrayBuffer | null; } catch { buf = null; }
        const cached = !!buf;
        if (!buf) {
          buf = await p.tts(text);
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
