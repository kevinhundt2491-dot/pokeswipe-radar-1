// CSP-Interpreter (public/js/csp-handlers.js): jeder on…-Handler der Vorlagen muss sich parsen lassen,
// und die Ausführung muss dieselbe Wirkung haben wie der Browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const sandbox: any = {};
vm.runInNewContext(readFileSync("public/js/csp-handlers.js", "utf8"), sandbox);
const H = sandbox.psInlineHandlers;

/** Ersetzt ${…}-Platzhalter (verschachtelt) durch eine Zahl, damit Vorlagen-Strings wie im Browser aussehen. */
function stripTemplates(src: string) {
  let out = "", i = 0;
  while (i < src.length) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1, j = i + 2;
      while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
      out += "1"; i = j; continue;
    }
    out += src[i++];
  }
  return out;
}
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function handlersIn(file: string) {
  // Kommentarzeilen auslassen (dort stehen nur Beispiele)
  const raw = readFileSync(file, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const text = stripTemplates(raw);
  const found: string[] = [];
  const re = /\son(click|change|input|keydown|keyup|error|toggle|load|submit|dblclick)=(["'])(.*?)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) found.push(decode(m[3]));
  return found;
}

const files = [
  "public/index.html", "public/promo.html", "public/umzug.html", "public/404.html",
  ...readdirSync("client").filter((f) => f.endsWith(".js")).map((f) => `client/${f}`),
  ...readdirSync("client/scanner").filter((f) => f.endsWith(".js")).map((f) => `client/scanner/${f}`),
  ...readdirSync("public/js").filter((f) => f.endsWith(".js")).map((f) => `public/js/${f}`),
  ...readdirSync("server").filter((f) => f.endsWith(".ts")).map((f) => `server/${f}`),
];

test("CSP-Interpreter: alle Inline-Handler der Vorlagen lassen sich parsen", () => {
  const failures: string[] = [];
  let count = 0;
  for (const f of files) {
    for (const h of handlersIn(f)) {
      count++;
      try { H.parse(h); } catch (e: any) { failures.push(`${f}: ${h} → ${e.message}`); }
    }
  }
  assert.ok(count > 200, `zu wenige Handler gefunden (${count})`);
  assert.deepEqual(failures, []);
});

test("CSP-Interpreter: Aufrufe, this, event, if, Zuweisung, Pfeilfunktion", async () => {
  const calls: any[] = [];
  const g: any = {
    PS: { openCard: (id: string) => calls.push(["openCard", id]), toggleFollow: (id: string, on: boolean) => Promise.resolve(calls.push(["follow", id, on])), openFollowing: () => calls.push(["following"]) },
    switchTab: (t: string) => calls.push(["tab", t]),
    document: { getElementById: (id: string) => ({ scrollIntoView: (o: any) => calls.push(["scroll", id, o.behavior]) }) },
  };
  const el: any = { value: "sv08", src: "x.png", checked: true };
  H.execute('PS.openCard("sv08-238")', el, {}, g);
  H.execute("switchTab('swipe'); document.getElementById('pack').scrollIntoView({behavior:'smooth'});", el, {}, g);
  H.execute("if(event.key==='Enter')PS.openCard(this.value)", el, { key: "Enter" }, g);
  H.execute("if(event.key==='Enter')PS.openCard(this.value)", el, { key: "a" }, g);
  H.execute("this.src='/card-fallback.svg'", el, {}, g);
  let stopped = false;
  H.execute("event.stopPropagation();PS.openCard('x')", el, { stopPropagation: () => { stopped = true; } }, g);
  await H.execute("PS.toggleFollow('u1', true).then(() => PS.openFollowing())", el, {}, g);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(el.src, "/card-fallback.svg");
  assert.equal(stopped, true);
  assert.deepEqual(calls, [["openCard", "sv08-238"], ["tab", "swipe"], ["scroll", "pack", "smooth"], ["openCard", "sv08"], ["openCard", "x"], ["follow", "u1", true], ["following"]]);
  assert.equal(H.execute("return false", el, {}, g), false);
  assert.equal(H.execute("PS.blockUser && PS.blockUser(1)", el, {}, g), undefined);
});

test("CSP-Interpreter: gefährliche Konstrukte werden abgelehnt", () => {
  const g: any = { PS: {}, eval: () => 1 };
  assert.throws(() => H.parse("new Function('x')"));
  assert.throws(() => H.execute("PS.constructor.constructor('alert(1)')()", {}, {}, g));
  assert.throws(() => H.execute("this.innerHTML='<img>'", {}, {}, g));
  assert.throws(() => H.execute("this.onclick=1", {}, {}, g));
  assert.throws(() => H.execute("unknownFn()", {}, {}, g));
});
