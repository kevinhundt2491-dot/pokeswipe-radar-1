/* PokeSwipe & Radar – CSP-sichere Ausführung der on…-Attribute (Phase 6)
 *
 * Die Content-Security-Policy erlaubt keine Inline-Skripte mehr ('unsafe-inline' ist aus script-src entfernt).
 * Damit blockiert der Browser auch Attribute wie onclick="PS.openCard(&quot;sv08-238&quot;)". Statt hunderte
 * Vorlagen umzuschreiben, liest dieses Skript die Attribute selbst und führt sie über einen kleinen, sicheren
 * Interpreter aus – ohne eval/new Function (also ohne 'unsafe-eval').
 *
 * Unterstützter Sprachumfang (genau das, was die Vorlagen verwenden):
 *   Anweisungen mit ;  •  if (Bedingung) Anweisung  •  return Ausdruck
 *   Aufrufe, Eigenschaften (a.b, a[b]), Zuweisung (this.src = '…'), &&, ||, !, ===, !==, ==, !=, <, >, <=, >=, +, -
 *   Literale: Zahlen, '…'/"…"-Strings (JSON-Escapes), true/false/null/undefined, {…}, […], () => Ausdruck
 *   Namen: this (Element), event, sonst globale Eigenschaften (window.*)
 *
 * Ist die CSP nicht aktiv (z. B. lokale Datei ohne Header), führt der Browser die Attribute selbst aus –
 * das erkennt eine Probe beim Start, und der Interpreter bleibt dann aus (keine Doppel-Ausführung).
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- Tokenizer
  var PUNCT = ["===", "!==", "=>", "==", "!=", "<=", ">=", "&&", "||", "(", ")", "[", "]", "{", "}", ",", ";", ".", ":", "=", "!", "<", ">", "+", "-", "?"];

  function tokenize(src) {
    var out = [], i = 0, n = src.length;
    while (i < n) {
      var ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
        var m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
        out.push({ t: "num", v: Number(m[0]) }); i += m[0].length; continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        var w = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))[0];
        out.push({ t: "id", v: w }); i += w.length; continue;
      }
      if (ch === "'" || ch === '"') {
        var q = ch, s = "", j = i + 1;
        while (j < n && src[j] !== q) {
          if (src[j] === "\\") {
            var e = src[j + 1];
            if (e === "u") { s += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)); j += 6; continue; }
            s += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "0": "\0" })[e] !== undefined ? ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", "0": "\0" })[e] : e;
            j += 2; continue;
          }
          s += src[j++];
        }
        if (j >= n) throw new SyntaxError("Unbeendeter String");
        out.push({ t: "str", v: s }); i = j + 1; continue;
      }
      var p = null;
      for (var k = 0; k < PUNCT.length; k++) if (src.startsWith(PUNCT[k], i)) { p = PUNCT[k]; break; }
      if (!p) throw new SyntaxError("Unerwartetes Zeichen: " + ch);
      out.push({ t: "p", v: p }); i += p.length;
    }
    out.push({ t: "eof" });
    return out;
  }

  // ---------------------------------------------------------------- Parser
  function parse(src) {
    var toks = tokenize(src), pos = 0;
    var peek = function (o) { return toks[pos + (o || 0)]; };
    var is = function (v, o) { var t = peek(o); return t.t === "p" && t.v === v; };
    var isId = function (v) { var t = peek(); return t.t === "id" && t.v === v; };
    var eat = function (v) { if (!is(v)) throw new SyntaxError("Erwartet " + v); pos++; };

    function program() {
      var body = [];
      while (peek().t !== "eof") {
        if (is(";")) { pos++; continue; }
        body.push(statement());
      }
      return { k: "prog", body: body };
    }
    function statement() {
      if (isId("if")) {
        pos++; eat("("); var test = expr(); eat(")");
        var cons = statement(), alt = null;
        if (isId("else")) { pos++; alt = statement(); }
        return { k: "if", test: test, cons: cons, alt: alt };
      }
      if (isId("return")) {
        pos++;
        if (is(";") || peek().t === "eof") return { k: "ret", arg: null };
        return { k: "ret", arg: expr() };
      }
      if (is("{")) {
        // Block nur, wenn kein Objektliteral gemeint ist (Anweisungsbeginn)
        pos++; var b = [];
        while (!is("}")) { if (is(";")) { pos++; continue; } b.push(statement()); }
        eat("}");
        return { k: "block", body: b };
      }
      return { k: "expr", e: expr() };
    }
    function expr() { return assign(); }
    function assign() {
      var left = ternary();
      if (is("=")) {
        if (left.k !== "id" && left.k !== "mem") throw new SyntaxError("Ungültiges Zuweisungsziel");
        pos++;
        return { k: "assign", target: left, value: assign() };
      }
      return left;
    }
    function ternary() {
      var test = or();
      if (is("?")) { pos++; var a = assign(); eat(":"); var b = assign(); return { k: "cond", test: test, a: a, b: b }; }
      return test;
    }
    function bin(next, ops) {
      return function () {
        var left = next();
        while (peek().t === "p" && ops.indexOf(peek().v) >= 0) { var op = toks[pos++].v; left = { k: "bin", op: op, l: left, r: next() }; }
        return left;
      };
    }
    var additive = bin(unary, ["+", "-"]);
    var rel = bin(additive, ["<", ">", "<=", ">="]);
    var eq = bin(rel, ["===", "!==", "==", "!="]);
    function and() { var l = eq(); while (is("&&")) { pos++; l = { k: "and", l: l, r: eq() }; } return l; }
    function or() { var l = and(); while (is("||")) { pos++; l = { k: "or", l: l, r: and() }; } return l; }
    function unary() {
      if (is("!")) { pos++; return { k: "not", e: unary() }; }
      if (is("-")) { pos++; return { k: "neg", e: unary() }; }
      if (is("+")) { pos++; return { k: "pos", e: unary() }; }
      return postfix();
    }
    function args() {
      var list = [];
      eat("(");
      while (!is(")")) { list.push(assign()); if (!is(")")) eat(","); }
      eat(")");
      return list;
    }
    function postfix() {
      var e = primary();
      for (;;) {
        if (is(".")) { pos++; var t = toks[pos++]; if (t.t !== "id") throw new SyntaxError("Eigenschaft erwartet"); e = { k: "mem", obj: e, prop: { k: "lit", v: t.v } }; }
        else if (is("[")) { pos++; var p = expr(); eat("]"); e = { k: "mem", obj: e, prop: p }; }
        else if (is("(")) { e = { k: "call", callee: e, args: args() }; }
        else return e;
      }
    }
    function arrowAhead() {
      // () => …   oder   (a, b) => …
      if (!is("(")) return false;
      var d = 0, o = 0;
      for (;;) {
        var t = peek(o);
        if (t.t === "eof") return false;
        if (t.t === "p" && t.v === "(") d++;
        if (t.t === "p" && t.v === ")") { d--; if (d === 0) return is("=>", o + 1); }
        o++;
      }
    }
    function primary() {
      var t = peek();
      if (arrowAhead()) {
        eat("(");
        var params = [];
        while (!is(")")) { var pt = toks[pos++]; if (pt.t !== "id") throw new SyntaxError("Parameter erwartet"); params.push(pt.v); if (!is(")")) eat(","); }
        eat(")"); eat("=>");
        var bodyNode = is("{") ? statement() : { k: "ret", arg: assign() };
        return { k: "arrow", params: params, body: bodyNode };
      }
      if (t.t === "num" || t.t === "str") { pos++; return { k: "lit", v: t.v }; }
      if (t.t === "id") {
        pos++;
        if (t.v === "true") return { k: "lit", v: true };
        if (t.v === "false") return { k: "lit", v: false };
        if (t.v === "null") return { k: "lit", v: null };
        if (t.v === "undefined") return { k: "lit", v: undefined };
        if (t.v === "this") return { k: "this" };
        if (["new", "function", "eval", "Function", "import", "constructor", "__proto__", "prototype"].indexOf(t.v) >= 0) throw new SyntaxError("Nicht erlaubt: " + t.v);
        return { k: "id", v: t.v };
      }
      if (is("(")) { pos++; var e = expr(); eat(")"); return e; }
      if (is("[")) {
        pos++; var items = [];
        while (!is("]")) { items.push(assign()); if (!is("]")) eat(","); }
        eat("]");
        return { k: "arr", items: items };
      }
      if (is("{")) {
        pos++; var props = [];
        while (!is("}")) {
          var kt = toks[pos++];
          if (kt.t !== "id" && kt.t !== "str" && kt.t !== "num") throw new SyntaxError("Schlüssel erwartet");
          eat(":");
          props.push([String(kt.v), assign()]);
          if (!is("}")) eat(",");
        }
        eat("}");
        return { k: "obj", props: props };
      }
      throw new SyntaxError("Unerwartetes Token");
    }
    var prog = program();
    return prog;
  }

  // ---------------------------------------------------------------- Auswertung
  var BLOCKED_PROPS = { constructor: 1, __proto__: 1, prototype: 1, __defineGetter__: 1, __defineSetter__: 1, __lookupGetter__: 1, __lookupSetter__: 1 };
  function RET(v) { this.v = v; }

  function evaluate(node, scope) {
    switch (node.k) {
      case "lit": return node.v;
      case "this": return scope.self;
      case "id":
        if (scope.vars && Object.prototype.hasOwnProperty.call(scope.vars, node.v)) return scope.vars[node.v];
        if (node.v === "event") return scope.event;
        if (node.v === "window" || node.v === "globalThis" || node.v === "self") return scope.global;
        if (!(node.v in scope.global)) throw new ReferenceError(node.v + " ist nicht definiert");
        return scope.global[node.v];
      case "mem": {
        var obj = evaluate(node.obj, scope), key = String(evaluate(node.prop, scope));
        if (BLOCKED_PROPS[key]) throw new TypeError("Nicht erlaubt: " + key);
        if (obj === null || obj === undefined) throw new TypeError("Eigenschaft " + key + " von " + obj);
        return obj[key];
      }
      case "call": {
        var fn, ctx;
        if (node.callee.k === "mem") {
          ctx = evaluate(node.callee.obj, scope);
          var k = String(evaluate(node.callee.prop, scope));
          if (BLOCKED_PROPS[k]) throw new TypeError("Nicht erlaubt: " + k);
          if (ctx === null || ctx === undefined) throw new TypeError("Methode " + k + " von " + ctx);
          fn = ctx[k];
        } else { fn = evaluate(node.callee, scope); ctx = undefined; }
        if (typeof fn !== "function") throw new TypeError("Keine Funktion");
        if (fn === root.eval || fn === root.Function || fn === root.setTimeout && node.args.length && node.args[0].k === "lit" && typeof node.args[0].v === "string") throw new TypeError("Nicht erlaubt");
        var a = node.args.map(function (x) { return evaluate(x, scope); });
        return fn.apply(ctx, a);
      }
      case "assign": {
        var val = evaluate(node.value, scope);
        if (node.target.k === "id") { scope.global[node.target.v] = val; return val; }
        var o = evaluate(node.target.obj, scope), pk = String(evaluate(node.target.prop, scope));
        if (BLOCKED_PROPS[pk] || /^on/i.test(pk) || pk === "innerHTML" || pk === "outerHTML" || pk === "srcdoc") throw new TypeError("Nicht erlaubt: " + pk);
        o[pk] = val;
        return val;
      }
      case "cond": return evaluate(node.test, scope) ? evaluate(node.a, scope) : evaluate(node.b, scope);
      case "and": { var l = evaluate(node.l, scope); return l ? evaluate(node.r, scope) : l; }
      case "or": { var l2 = evaluate(node.l, scope); return l2 ? l2 : evaluate(node.r, scope); }
      case "not": return !evaluate(node.e, scope);
      case "neg": return -evaluate(node.e, scope);
      case "pos": return +evaluate(node.e, scope);
      case "bin": {
        var x = evaluate(node.l, scope), y = evaluate(node.r, scope);
        switch (node.op) {
          case "===": return x === y; case "!==": return x !== y;
          case "==": return x == y; case "!=": return x != y; // eslint-disable-line eqeqeq
          case "<": return x < y; case ">": return x > y; case "<=": return x <= y; case ">=": return x >= y;
          case "+": return x + y; case "-": return x - y;
        }
        throw new SyntaxError("Operator " + node.op);
      }
      case "arr": return node.items.map(function (x) { return evaluate(x, scope); });
      case "obj": {
        var out = {};
        node.props.forEach(function (p) { if (!BLOCKED_PROPS[p[0]]) out[p[0]] = evaluate(p[1], scope); });
        return out;
      }
      case "arrow":
        return function () {
          var vars = Object.create(scope.vars || null), argv = arguments;
          node.params.forEach(function (name, i) { vars[name] = argv[i]; });
          var r = run(node.body, { self: scope.self, event: scope.event, global: scope.global, vars: vars });
          return r instanceof RET ? r.v : r;
        };
    }
    throw new SyntaxError("Unbekannter Knoten " + node.k);
  }

  function run(node, scope) {
    switch (node.k) {
      case "prog": case "block": {
        for (var i = 0; i < node.body.length; i++) {
          var r = run(node.body[i], scope);
          if (r instanceof RET) return r;
        }
        return undefined;
      }
      case "if": {
        if (evaluate(node.test, scope)) return run(node.cons, scope);
        if (node.alt) return run(node.alt, scope);
        return undefined;
      }
      case "ret": return new RET(node.arg ? evaluate(node.arg, scope) : undefined);
      case "expr": evaluate(node.e, scope); return undefined;
    }
    throw new SyntaxError("Unbekannte Anweisung " + node.k);
  }

  var cache = new Map();
  function compile(src) {
    var hit = cache.get(src);
    if (hit) return hit;
    var ast = parse(src);
    if (cache.size > 2000) cache.clear();
    cache.set(src, ast);
    return ast;
  }

  /** Führt einen Handler-Text aus; liefert den return-Wert (false = Standardaktion verhindern). */
  function execute(src, self, event, global) {
    var r = run(compile(src), { self: self, event: event, global: global || root, vars: null });
    return r instanceof RET ? r.v : undefined;
  }

  var api = { tokenize: tokenize, parse: parse, execute: execute };
  root.psInlineHandlers = api;

  // ---------------------------------------------------------------- Browser-Anbindung
  if (typeof document === "undefined" || typeof window === "undefined") return;

  // Probe: führt der Browser Inline-Handler noch selbst aus (CSP nicht aktiv)? Dann nichts tun.
  try {
    var probe = document.createElement("div");
    probe.setAttribute("onclick", "window.__psInlineProbe=1");
    probe.click();
  } catch (e) {}
  if (window.__psInlineProbe === 1) { try { delete window.__psInlineProbe; } catch (e) { window.__psInlineProbe = undefined; } return; }

  function fire(el, type, ev) {
    var src = el.getAttribute && el.getAttribute("on" + type);
    if (!src) return;
    try {
      if (execute(src, el, ev, window) === false) ev.preventDefault();
    } catch (err) {
      if (window.console) console.error("Aktion fehlgeschlagen (on" + type + ")", err && err.message ? err.message : err, src.slice(0, 160));
    }
  }

  // Bubbelnde Ereignisse: Pfad vom Ziel bis zum Dokument wie beim Browser abarbeiten (stopPropagation beachten)
  ["click", "input", "change", "keydown", "keyup", "submit", "dblclick"].forEach(function (type) {
    document.addEventListener(type, function (ev) {
      var node = ev.target;
      if (node && node.nodeType === 3) node = node.parentElement;
      while (node && node !== document) {
        if (node.nodeType === 1 && node.hasAttribute("on" + type)) {
          if (node.disabled && type === "click") break;
          fire(node, type, ev);
          if (ev.cancelBubble) break;
        }
        node = node.parentElement;
      }
    }, false);
  });
  // Nicht bubbelnde Ereignisse (Bildfehler, <details>-Umschalten, Laden): nur am Ziel, in der Capture-Phase abfangen
  ["error", "toggle", "load"].forEach(function (type) {
    document.addEventListener(type, function (ev) {
      var t = ev.target;
      if (t && t.nodeType === 1 && t.hasAttribute("on" + type)) fire(t, type, ev);
    }, true);
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
