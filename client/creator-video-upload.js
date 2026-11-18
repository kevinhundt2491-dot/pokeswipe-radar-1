// Showcase-Video für /creator#video hochladen (Admin): in 3-MB-Stücken an /api/admin/creator-video/* –
// genutzt vom Creator-Finder (Datei-Upload) und vom Pro-Reel-Generator („📌 Auf /creator#video veröffentlichen“).
import { api } from "./core.js";

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ""));
  r.onerror = () => reject(r.error || new Error("Datei konnte nicht gelesen werden."));
  r.readAsDataURL(blob);
});
const toBase64 = async (blob) => (await toDataUrl(blob)).replace(/^data:[^,]*,/, "");

/** Lädt ein MP4/WebM hoch und veröffentlicht es auf /creator#video. `poster` = optionales JPEG-Blob. */
export async function uploadCreatorVideo(blob, { source = "upload", poster = null, onProgress = () => {} } = {}) {
  const type = String(blob?.type || "").split(";")[0] || "video/mp4";
  const start = await api("/api/admin/creator-video/start", { method: "POST", body: { size: blob.size, type, source } });
  const size = Number(start.chunkBytes);
  for (let i = 0; i < start.chunks; i++) {
    const data = await toBase64(blob.slice(i * size, Math.min(blob.size, (i + 1) * size)));
    let tries = 0;
    while (true) {
      try { await api("/api/admin/creator-video/chunk", { method: "POST", body: { version: start.version, index: i, data } }); break; }
      catch (e) {
        if ((e.status === 429 || e.transient) && tries++ < 4) { await new Promise((r) => setTimeout(r, 4000)); continue; }
        throw e;
      }
    }
    onProgress((i + 1) / start.chunks);
  }
  let posterUrl = "";
  if (poster && poster.size && poster.size < 600_000 && /jpe?g/.test(poster.type)) posterUrl = await toDataUrl(poster).catch(() => "");
  return api("/api/admin/creator-video/finish", { method: "POST", body: { version: start.version, poster: posterUrl } });
}

export const creatorVideoStatus = () => api("/api/admin/creator-video");
export const deleteCreatorVideo = () => api("/api/admin/creator-video", { method: "DELETE" });
