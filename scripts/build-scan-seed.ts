// PokeSwipe & Radar – erzeugt den vorberechneten Basis-Index für den On-Device-Scanner.
//
// Lädt für alle TCGdex-Karten (Deutsch, Englisch, Japanisch; ohne digitale TCG-Pocket-Karten) das kleine Bild (low.jpg),
// berechnet dieselben drei Fingerabdrücke wie der Job scan-hash-index (pHash/dHash des Artworks, pHash der ganzen Karte)
// und schreibt sie komprimiert nach server/scan-seed/<lang>.ts. Der Server übernimmt diese Werte beim ersten Lauf für alle
// Karten im Katalog (gleiches Bild vorausgesetzt) – der Scanner kennt damit sofort den ganzen Katalog statt „0 / 2.753“.
//
// Aufruf (Node 24):  node scripts/build-scan-seed.ts [de en ja]
// Zwischenstände liegen in .scan-seed-cache/ (wird bei erneutem Aufruf fortgesetzt).
import { mkdirSync, existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import jpeg from "jpeg-js";
import { referenceHashes, wordsToHex } from "../server/scan-logic.ts";

const LANGS = (process.argv.slice(2).length ? process.argv.slice(2) : ["de", "en", "ja"]).filter((l) => ["de", "en", "ja"].includes(l));
const CACHE = ".scan-seed-cache";
const CONCURRENCY = 24;
const ASSET = "https://assets.tcgdex.net/";
mkdirSync(CACHE, { recursive: true });
mkdirSync("server/scan-seed", { recursive: true });

async function hash(path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${ASSET}${path}/low.jpg`, { signal: AbortSignal.timeout(10000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(String(res.status));
      const buf = new Uint8Array(await res.arrayBuffer());
      const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
      if (!(img.width > 50 && img.height > 70)) return null;
      const h = referenceHashes(img.data, img.width, img.height, 4);
      return [wordsToHex(h[0], h[1]), wordsToHex(h[2], h[3]), wordsToHex(h[4], h[5])];
    } catch {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

for (const lang of LANGS) {
  const cacheFileEarly = `${CACHE}/${lang}.tsv`;
  let list: any[] = [];
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/${lang}/cards`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(String(res.status));
    list = await res.json();
  } catch (e) {
    // TCGdex nicht erreichbar: nur aus den Zwischenständen erzeugen
    if (!existsSync(cacheFileEarly)) throw e;
    console.warn(`${lang}: TCGdex nicht erreichbar – nutze Zwischenstände`);
    list = readFileSync(cacheFileEarly, "utf8").split("\n").filter(Boolean).map((l) => { const [id, path] = l.split("\t"); return { id, image: `${ASSET}${path}` }; });
  }
  const todo = list
    .filter((c) => c?.id && c.image && String(c.image).startsWith(ASSET) && !String(c.image).includes("/tcgp/"))
    .map((c) => ({ id: String(c.id), path: String(c.image).slice(ASSET.length) }));
  const cacheFile = `${CACHE}/${lang}.tsv`;
  const done = new Map<string, string>();
  if (existsSync(cacheFile)) {
    for (const line of readFileSync(cacheFile, "utf8").split("\n")) {
      const id = line.split("\t")[0];
      if (id) done.set(id, line);
    }
  }
  const queue = todo.filter((t) => !done.has(t.id));
  console.log(`${lang}: ${todo.length} Karten, ${done.size} bereits berechnet, ${queue.length} offen`);
  let n = 0;
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift()!;
      const h = await hash(t.path);
      const line = h ? `${t.id}\t${t.path}\t${h[0]}\t${h[1]}\t${h[2]}` : `${t.id}\t${t.path}\t-\t-\t-`;
      done.set(t.id, line);
      appendFileSync(cacheFile, line + "\n");
      if (++n % 500 === 0) console.log(`${lang}: ${n} / ${todo.length - (todo.length - queue.length - n)} …`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const lines = todo.map((t) => done.get(t.id)).filter((l): l is string => !!l && !l.endsWith("\t-\t-\t-")).sort();
  // In kleinen Teilen (je ≤ 2.000 Karten, ~80 KB) speichern – große Einzeldateien werden von manchen Git-Workflows verworfen
  const CHUNK = 2000;
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i += CHUNK) {
    const n = parts.length;
    const b64 = gzipSync(Buffer.from(lines.slice(i, i + CHUNK).join("\n"), "utf8"), { level: 9 }).toString("base64");
    writeFileSync(`server/scan-seed/${lang}-${n}.ts`, `// Automatisch erzeugt von scripts/build-scan-seed.ts – nicht von Hand bearbeiten.\nexport default ${JSON.stringify(b64)};\n`);
    parts.push(`${lang}-${n}`);
  }
  writeFileSync(`server/scan-seed/${lang}.ts`,
    `// Automatisch erzeugt von scripts/build-scan-seed.ts – nicht von Hand bearbeiten.\n` +
    `// ${lines.length} Karten (${lang}), Stand ${new Date().toISOString().slice(0, 10)}. Je Teil gzip+Base64: id \\t Bildpfad \\t artP \\t artD \\t fullP\n` +
    parts.map((p, i) => `import p${i} from "./${p}.ts";\n`).join("") +
    `export const COUNT = ${lines.length};\nexport const BUILT_AT = ${JSON.stringify(new Date().toISOString())};\nexport const PARTS: string[] = [${parts.map((_, i) => `p${i}`).join(", ")}];\n`);
  console.log(`${lang}: ${lines.length} Fingerabdrücke in ${parts.length} Teilen geschrieben`);
}
