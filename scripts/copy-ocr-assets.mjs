// Kopiert die Tesseract.js-Dateien für die Texterkennung ohne KI nach public/assets/ocr/ (selbst gehostet statt CDN –
// passt zur Content-Security-Policy und funktioniert offline). Nur der LSTM-Kern (OEM 1) und Englisch („best_int“).
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = join(process.cwd(), "public/assets/ocr");
mkdirSync(out, { recursive: true });
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const files = [
  [join(pkgDir("tesseract.js"), "dist/worker.min.js"), "worker.min.js"],
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]
    .map((f) => [join(pkgDir("tesseract.js-core"), f), f]),
  [join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"), "eng.traineddata.gz"],
];
for (const [from, to] of files) {
  if (!existsSync(from)) { console.error(`OCR-Datei fehlt: ${from}`); process.exit(1); }
  copyFileSync(from, join(out, to));
}
console.log(`OCR-Dateien kopiert: ${files.length} → public/assets/ocr`);
