// Showcase-Video für /creator#video (Set-Binder + 1-Klick-Inserieren).
// Der Pro-Reel-Generator (oder ein Admin-Upload) lädt das fertige MP4 in Stücken (≤ 3 MB, wegen des 6-MB-Anfragelimits)
// in Netlify Blobs hoch. Öffentlich abrufbar unter /api/creator/video (mit Range-Anfragen – Safari/iOS braucht das zum Abspielen).
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { log } from "./log.ts";

type Hlp = { auth: any; adminOnly: any; body: (c: any) => Promise<Record<string, any>> };
export type VideoManifest = { version: string; size: number; chunkSize: number; chunks: number; type: string; uploadedAt: string; source: string; poster: boolean };

export const VIDEO_CHUNK_BYTES = 3 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 95 * 1024 * 1024;
const TYPES = ["video/mp4", "video/webm"];
const store = () => getStore({ name: "creator-video", consistency: "strong" });
const VERSION_RE = /^[A-Za-z0-9_-]{8,40}$/;

/** Erkennt MP4 („ftyp“ ab Byte 4) bzw. WebM (EBML-Kopf) am Dateianfang. */
export function sniffVideoType(head: Uint8Array): string {
  if (head.length >= 12 && String.fromCharCode(head[4], head[5], head[6], head[7]) === "ftyp") return "video/mp4";
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
  return "";
}

/** Range-Kopf „bytes=a-b“ → begrenzter Bereich innerhalb eines Stücks (höchstens bis zum Stück-Ende). */
export function rangeFor(header: string | undefined, size: number, chunkSize: number) {
  let start = 0, end = size - 1, partial = false;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (m && (m[1] || m[2])) {
    partial = true;
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
    else { start = Math.max(0, size - Number(m[2])); end = size - 1; } // Suffix-Bereich „bytes=-500“
    if (start >= size || start > end) return { ok: false as const, start: 0, end: 0, partial };
  }
  const chunk = Math.floor(start / chunkSize);
  // Eine Antwort umfasst höchstens ein gespeichertes Stück – der Browser fordert den Rest selbst nach
  if (partial) end = Math.min(end, (chunk + 1) * chunkSize - 1);
  return { ok: true as const, start, end, partial, chunk };
}

export async function videoManifest(): Promise<VideoManifest | null> {
  try { return ((await store().get("manifest", { type: "json" })) as VideoManifest) || null; } catch { return null; }
}

async function dropVersion(version: string) {
  try {
    const { blobs } = await store().list({ prefix: `v/${version}/` });
    for (const b of blobs) await store().delete(b.key).catch(() => {});
  } catch {}
}

export function registerCreatorVideo(app: any, hlp: Hlp) {
  const { auth, adminOnly, body } = hlp;

  // ---------------- Öffentlich ----------------
  app.get("/api/creator/video/meta", async (c: any) => {
    const m = await videoManifest();
    c.header("Cache-Control", "public, max-age=60");
    if (!m) return c.json({ available: false });
    return c.json({
      available: true, version: m.version, type: m.type, size: m.size, uploadedAt: m.uploadedAt,
      url: `/api/creator/video?v=${m.version}`, poster: m.poster ? `/api/creator/video/poster?v=${m.version}` : "",
    });
  });

  app.get("/api/creator/video", async (c: any) => {
    const m = await videoManifest();
    if (!m) return c.json({ error: "Noch kein Video hinterlegt." }, 404);
    const r = rangeFor(c.req.header("range"), m.size, m.chunkSize);
    const common: Record<string, string> = {
      "Content-Type": m.type, "Accept-Ranges": "bytes",
      // Versionierte URL darf lange gecacht werden; ohne ?v= nur kurz (neues Video soll schnell sichtbar sein)
      "Cache-Control": c.req.query("v") === m.version ? "public, max-age=31536000, immutable" : "public, max-age=120",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (!r.ok) return c.body(null, 416, { ...common, "Content-Range": `bytes */${m.size}` });
    if (r.partial) {
      const buf = (await store().get(`v/${m.version}/${r.chunk}`, { type: "arrayBuffer" })) as ArrayBuffer | null;
      if (!buf) return c.json({ error: "Video unvollständig." }, 500);
      const off = r.chunk! * m.chunkSize;
      const part = new Uint8Array(buf).subarray(r.start - off, r.end - off + 1);
      return c.body(part, 206, { ...common, "Content-Range": `bytes ${r.start}-${r.start + part.byteLength - 1}/${m.size}`, "Content-Length": String(part.byteLength) });
    }
    // Ohne Range (z. B. „Video herunterladen“): alle Stücke nacheinander streamen
    let i = 0;
    const stream = new ReadableStream({
      async pull(ctrl) {
        if (i >= m.chunks) return ctrl.close();
        const buf = (await store().get(`v/${m.version}/${i++}`, { type: "arrayBuffer" })) as ArrayBuffer | null;
        if (!buf) return ctrl.error(new Error("Stück fehlt"));
        ctrl.enqueue(new Uint8Array(buf));
      },
    });
    return new Response(stream, { status: 200, headers: { ...common, "Content-Length": String(m.size) } });
  });

  app.get("/api/creator/video/poster", async (c: any) => {
    const m = await videoManifest();
    if (!m?.poster) return c.notFound();
    const buf = (await store().get(`v/${m.version}/poster`, { type: "arrayBuffer" })) as ArrayBuffer | null;
    if (!buf) return c.notFound();
    return c.body(buf, 200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400", "Content-Security-Policy": "default-src 'none'; sandbox" });
  });

  // ---------------- Admin: Upload in Stücken ----------------
  app.get("/api/admin/creator-video", auth, adminOnly, async (c: any) => {
    const m = await videoManifest();
    return c.json({ video: m, url: m ? `/api/creator/video?v=${m.version}` : "", page: "/creator#video", chunkBytes: VIDEO_CHUNK_BYTES, maxBytes: VIDEO_MAX_BYTES });
  });

  app.post("/api/admin/creator-video/start", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const size = Math.round(Number(b.size) || 0);
    const type = String(b.type || "").split(";")[0].trim().toLowerCase();
    if (!TYPES.includes(type)) return c.json({ error: "Bitte ein MP4- (oder WebM-)Video wählen." }, 400);
    if (size < 10_000 || size > VIDEO_MAX_BYTES) return c.json({ error: `Video muss zwischen 10 KB und ${VIDEO_MAX_BYTES / 1024 / 1024} MB groß sein.` }, 400);
    const version = `${Date.now().toString(36)}${randomBytes(6).toString("base64url")}`;
    await store().setJSON(`pending/${version}`, { size, type, chunks: Math.ceil(size / VIDEO_CHUNK_BYTES), source: String(b.source || "upload").slice(0, 80), at: Date.now() });
    return c.json({ version, chunkBytes: VIDEO_CHUNK_BYTES, chunks: Math.ceil(size / VIDEO_CHUNK_BYTES) });
  });

  app.post("/api/admin/creator-video/chunk", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const version = String(b.version || "");
    if (!VERSION_RE.test(version)) return c.json({ error: "Ungültige Upload-ID." }, 400);
    const p = (await store().get(`pending/${version}`, { type: "json" })) as any;
    if (!p) return c.json({ error: "Upload nicht gefunden – bitte neu starten." }, 404);
    const index = Math.round(Number(b.index));
    if (!Number.isInteger(index) || index < 0 || index >= p.chunks) return c.json({ error: "Ungültiges Stück." }, 400);
    const data = String(b.data || "");
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) return c.json({ error: "Ungültige Daten." }, 400);
    const bytes = Buffer.from(data, "base64");
    const expected = index === p.chunks - 1 ? p.size - index * VIDEO_CHUNK_BYTES : VIDEO_CHUNK_BYTES;
    if (bytes.length !== expected) return c.json({ error: `Stück ${index + 1} hat die falsche Größe.` }, 400);
    if (index === 0 && sniffVideoType(bytes.subarray(0, 16)) !== p.type) return c.json({ error: "Die Datei ist kein gültiges Video." }, 400);
    await store().set(`v/${version}/${index}`, new Uint8Array(bytes).buffer);
    return c.json({ ok: true, index });
  });

  app.post("/api/admin/creator-video/finish", auth, adminOnly, async (c: any) => {
    const b = await body(c);
    const version = String(b.version || "");
    if (!VERSION_RE.test(version)) return c.json({ error: "Ungültige Upload-ID." }, 400);
    const p = (await store().get(`pending/${version}`, { type: "json" })) as any;
    if (!p) return c.json({ error: "Upload nicht gefunden – bitte neu starten." }, 404);
    const { blobs } = await store().list({ prefix: `v/${version}/` });
    const have = new Set(blobs.map((x) => x.key));
    for (let i = 0; i < p.chunks; i++) if (!have.has(`v/${version}/${i}`)) return c.json({ error: `Stück ${i + 1} fehlt – bitte erneut hochladen.` }, 409);
    // Optionales Vorschaubild (JPEG, ≤ 600 KB)
    let poster = false;
    const pm = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.poster || ""));
    if (pm && pm[1].length < 820_000) {
      const img = Buffer.from(pm[1], "base64");
      if (img[0] === 0xff && img[1] === 0xd8) { await store().set(`v/${version}/poster`, new Uint8Array(img).buffer); poster = true; }
    }
    const old = await videoManifest();
    const m: VideoManifest = { version, size: p.size, chunkSize: VIDEO_CHUNK_BYTES, chunks: p.chunks, type: p.type, uploadedAt: new Date().toISOString(), source: p.source, poster };
    await store().setJSON("manifest", m);
    await store().delete(`pending/${version}`).catch(() => {});
    if (old && old.version !== version) await dropVersion(old.version);
    log.info("creator", "Showcase-Video für /creator#video veröffentlicht", { version, sizeMb: Math.round(p.size / 1048576), source: p.source });
    return c.json({ ok: true, video: m, url: `/api/creator/video?v=${version}`, page: "/creator#video" });
  });

  app.delete("/api/admin/creator-video", auth, adminOnly, async (c: any) => {
    const m = await videoManifest();
    if (m) { await store().delete("manifest"); await dropVersion(m.version); }
    return c.json({ ok: true });
  });
}
