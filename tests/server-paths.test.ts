import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const quoted = (s: string) => [...s.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

test("Server-Pfade: netlify/server/index.ts und [server] in netlify.toml sind identisch", () => {
  const toml = read("../netlify.toml");
  const tomlPaths = quoted(/\[server\][\s\S]*?path\s*=\s*\[([\s\S]*?)\]/.exec(toml)?.[1] || "");
  const entry = read("../netlify/server/index.ts");
  const entryPaths = quoted(/path:\s*\[([\s\S]*?)\]/.exec(entry)?.[1] || "");
  assert.ok(tomlPaths.length > 10);
  assert.deepEqual(entryPaths, tomlPaths);
});

test("Server-Pfade: alle öffentlichen Server-Seiten sind weitergeleitet", () => {
  const entry = read("../netlify/server/index.ts");
  for (const p of ["/pokemon/*", "/sealed/*", "/trends", "/s/*", "/einladung/*", "/u/*", "/p/*", "/shop/*", "/.well-known/assetlinks.json"]) {
    assert.ok(entry.includes(`"${p}"`), `${p} fehlt`);
  }
});
