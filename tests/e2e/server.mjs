// Minimaler Static-Server für die E2E-Tests: liefert public/ aus (Standard-Index, saubere URLs).
// /assets kann über E2E_ASSETS_DIR auf ein anderes Bundle-Verzeichnis zeigen (sonst public/assets aus `npm run build`).
// Die API wird in den Tests per page.route simuliert; was dort nicht abgefangen wird, beantwortet der Server mit 404-JSON.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, resolve } from "node:path";

const ROOT = resolve(process.cwd(), "public");
const ASSETS = process.env.E2E_ASSETS_DIR ? resolve(process.env.E2E_ASSETS_DIR) : join(ROOT, "assets");
const PORT = Number(process.env.E2E_PORT || 4173);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};

async function file(p) {
  try { const s = await stat(p); return s.isFile() ? p : null; } catch { return null; }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const path = decodeURIComponent(url.pathname);
  if (path.startsWith("/api/") || path.startsWith("/.netlify/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Nicht gefunden (E2E-Server)" }));
  }
  const base = path.startsWith("/assets/") ? ASSETS : ROOT;
  const rel = path.startsWith("/assets/") ? path.slice("/assets".length) : path;
  const target = normalize(join(base, rel));
  if (!target.startsWith(base)) { res.writeHead(403); return res.end(); }
  const found = (await file(target)) || (await file(join(target, "index.html"))) || (await file(`${target}.html`)) || (!extname(path) ? join(ROOT, "index.html") : null);
  if (!found) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[extname(found)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(await readFile(found));
}).listen(PORT, "127.0.0.1", () => console.log(`E2E-Server: http://127.0.0.1:${PORT} (assets: ${ASSETS})`));
