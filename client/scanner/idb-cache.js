// PokeSwipe & Radar – kleiner IndexedDB-Speicher für den Scanner (Haupt-Thread und Web Worker).
// Stores: „kv“ (Scanner-Index je Sprache, Text-Index) und „layout“ (Farb-/Layout-Fingerabdrücke je Karte).
// Ohne IndexedDB (privater Modus, alte Browser) liefern alle Funktionen still null bzw. tun nichts.
const DB_NAME = "ps-scan-cache";
const DB_VERSION = 1;
const STORES = ["kv", "layout"];
let dbP = null;

function openDb() {
  if (dbP) return dbP;
  dbP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbP;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) { resolve(null); return; }
    try {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      const out = fn(os);
      t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out?.value ?? null);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch { resolve(null); }
  }));
}

export const idbGet = (store, key) => tx(store, "readonly", (os) => os.get(key));
export const idbSet = (store, key, value) => tx(store, "readwrite", (os) => { os.put(value, key); return { value: true }; });

/** Mehrere Schlüssel auf einmal lesen → Map(key → Wert) (fehlende Schlüssel fehlen in der Map). */
export function idbGetMany(store, keys) {
  return openDb().then((db) => new Promise((resolve) => {
    const out = new Map();
    if (!db || !keys.length) { resolve(out); return; }
    try {
      const t = db.transaction(store, "readonly");
      const os = t.objectStore(store);
      for (const k of keys) { const r = os.get(k); r.onsuccess = () => { if (r.result !== undefined) out.set(k, r.result); }; }
      t.oncomplete = () => resolve(out);
      t.onerror = () => resolve(out);
    } catch { resolve(out); }
  }));
}

export function idbSetMany(store, entries) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db || !entries.length) { resolve(false); return; }
    try {
      const t = db.transaction(store, "readwrite");
      const os = t.objectStore(store);
      for (const [k, v] of entries) os.put(v, k);
      t.oncomplete = () => resolve(true);
      t.onerror = () => resolve(false);
    } catch { resolve(false); }
  }));
}

/**
 * JSON mit IndexedDB-Zwischenspeicher: frischer Eintrag (jünger als maxAgeMs) → sofort ohne Netz; sonst laden und
 * speichern. Ohne Netz wird auch ein älterer Eintrag genommen (Offline-Scan).
 */
export async function cachedJson(url, { maxAgeMs = 3 * 3600_000, fetchInit = {} } = {}) {
  const hit = await idbGet("kv", url).catch(() => null);
  if (hit?.data && Date.now() - Number(hit.at || 0) < maxAgeMs) return { data: hit.data, cached: true };
  try {
    const res = await fetch(url, fetchInit);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    idbSet("kv", url, { at: Date.now(), data }).catch(() => {});
    return { data, cached: false };
  } catch (e) {
    if (hit?.data) return { data: hit.data, cached: true, stale: true };
    throw e;
  }
}
