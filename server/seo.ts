// PokeSwipe & Radar – zusätzliche öffentliche SEO-Seiten für deutsche Suchanfragen:
//   /pokemon            Pokémon A–Z (alle Arten mit Karten im Katalog)
//   /pokemon/<name>     „Glurak Karten Wert“: alle Karten einer Pokémon-Art mit Preis, wertvollste zuerst, FAQ
//   /sealed             Displays, ETBs, Top-Trainer-Boxen mit Marktpreis vs. UVP
//   /sealed/<name>      Einzelprodukt mit Preisverlauf, Preis pro Booster und Community-Angeboten
//   /trends             Gewinner & Verlierer der letzten 30 Tage, meistgesuchte Karten
// Dazu die Teil-Sitemaps /sitemaps/pokemon.xml und /sitemaps/sealed.xml sowie die Katalog-Pflege
// (Pokémon-Arten aus den Kartendaten ableiten, englische Namen ergänzen, fehlende Sealed-Slugs vergeben).
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pokemonSpecies, sealedProducts } from "../db/index.ts";
import { SITE, h, slugify, cdnImage, pageShell, ebayUrl, cardmarketSearch, chartSvg } from "./growth.ts";
import { rows, rateLimit, clientIp, euro } from "./util.ts";
import { baseSpeciesName } from "./logic.ts";

export { baseSpeciesName };

const SPECIES_REFRESH_MS = 6 * 3600_000;
const cacheHeaders = (c: any, maxAge = 600, cdn = 3600) => {
  c.header("Cache-Control", `public, max-age=${maxAge}`);
  c.header("Netlify-CDN-Cache-Control", `public, s-maxage=${cdn}, stale-while-revalidate=86400`);
};
const crumbs = (items: [string, string][]) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE()}${path}` })),
});
const cardLink = (x: { id: string; name: string }) => `/karte/${encodeURIComponent(x.id)}/${slugify(x.name)}`;
const sealedSlug = (p: { id: number; slug: string | null; name: string }) => p.slug || `${p.id}-${slugify(p.name)}`;
const KIND_LABEL: Record<string, string> = {
  display: "Display", etb: "Elite-Trainer-Box", ttb: "Top-Trainer-Box", bundle: "Booster-Bundle", booster: "Booster",
  tin: "Tin-Box", collection: "Kollektion", other: "Sonstiges",
};
const CSS = `<style>.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}.ci{background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:6px;text-decoration:none;font-size:12px;display:block}
.ci img{width:100%;border-radius:8px;display:block;aspect-ratio:245/342;object-fit:cover;background:#0f172a}.ci b{display:block;color:#34d399;font-size:13px}.ci span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.az{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px}.az a{background:#0b1220;border:1px solid #1e293b;border-radius:10px;padding:7px 10px;text-decoration:none;font-size:13px;display:flex;justify-content:space-between;gap:6px}
.crumb{font-size:12px;color:#94a3b8;margin-bottom:10px}.crumb a{color:#cbd5e1}.letters{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.letters a{background:#1e293b;border-radius:8px;padding:3px 9px;font-weight:900;text-decoration:none;font-size:13px}
details{background:#0b1220;border:1px solid #1e293b;border-radius:14px;padding:10px 12px;margin-bottom:8px}summary{font-weight:800;cursor:pointer}</style>`;

// ---------------------------------------------------------------------------
// Katalog-Pflege (läuft im Katalog-Import mit)
// ---------------------------------------------------------------------------
/** Leitet die Pokémon-Arten aus den Kartendaten ab (häufigster Grundname je Pokédex-Nr.). */
export async function rebuildSpecies(force = false) {
  const [last] = rows(await db.execute(sql`SELECT max(updated_at) AS t, count(*)::int AS n FROM pokemon_species`));
  if (!force && last?.t && Date.now() - new Date(last.t).getTime() < SPECIES_REFRESH_MS) return 0;
  const list = rows(await db.execute(sql`
    SELECT dex_id, id, name, COALESCE(trend, avg, low)::float AS price FROM cards WHERE dex_id IS NOT NULL
  `));
  if (!list.length) return 0;
  const byDex = new Map<number, { names: Map<string, number>; cards: number; priced: number; topId: string | null; topPrice: number }>();
  for (const r of list) {
    const d = Number(r.dex_id);
    const e = byDex.get(d) || { names: new Map(), cards: 0, priced: 0, topId: null, topPrice: 0 };
    const base = baseSpeciesName(r.name);
    if (base) e.names.set(base, (e.names.get(base) || 0) + 1);
    e.cards++;
    const p = Number(r.price) || 0;
    if (p > 0) e.priced++;
    if (!e.topId || p > e.topPrice) { e.topId = r.id; e.topPrice = p; }
    byDex.set(d, e);
  }
  const used = new Set<string>();
  const values = [...byDex.entries()].sort((a, b) => a[0] - b[0]).flatMap(([dexId, e]) => {
    const name = [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0];
    if (!name) return [];
    let slug = slugify(name);
    if (used.has(slug)) slug = `${slug}-${dexId}`;
    used.add(slug);
    return [{ dexId, nameDe: name.slice(0, 80), slug, cardCount: e.cards, pricedCount: e.priced, topCardId: e.topId, topPrice: e.topPrice ? e.topPrice.toFixed(2) : null, updatedAt: new Date() }];
  });
  // Arten ohne Karten entfernen; nur bei umbenannten Arten den alten Slug kurz freigeben (eindeutiger Index)
  const existing = new Map((await db.select({ dexId: pokemonSpecies.dexId, slug: pokemonSpecies.slug }).from(pokemonSpecies)).map((r) => [r.dexId, r.slug]));
  const keep = new Set(values.map((v) => v.dexId));
  const orphans = [...existing.keys()].filter((d) => !keep.has(d));
  if (orphans.length) await db.delete(pokemonSpecies).where(inArray(pokemonSpecies.dexId, orphans));
  const renamed = values.filter((v) => existing.has(v.dexId) && existing.get(v.dexId) !== v.slug).map((v) => v.dexId);
  if (renamed.length) await db.update(pokemonSpecies).set({ slug: sql`'tmp-' || ${pokemonSpecies.dexId}::text` }).where(inArray(pokemonSpecies.dexId, renamed));
  for (let i = 0; i < values.length; i += 200) {
    await db.insert(pokemonSpecies).values(values.slice(i, i + 200)).onConflictDoUpdate({
      target: pokemonSpecies.dexId,
      set: { nameDe: sql`excluded.name_de`, slug: sql`excluded.slug`, cardCount: sql`excluded.card_count`, pricedCount: sql`excluded.priced_count`,
        topCardId: sql`excluded.top_card_id`, topPrice: sql`excluded.top_price`, updatedAt: sql`excluded.updated_at` },
    });
  }
  return values.length;
}

/** Ergänzt englische Namen (z. B. „Charizard“ zu „Glurak“) – viele deutsche Sammler suchen beide Begriffe. */
export async function fillEnglishNames(max = 12, deadline = Date.now() + 8000) {
  const todo = await db.select({ dexId: pokemonSpecies.dexId, topCardId: pokemonSpecies.topCardId }).from(pokemonSpecies)
    .where(eq(pokemonSpecies.nameEn, "")).orderBy(asc(pokemonSpecies.dexId)).limit(max);
  let done = 0;
  for (const s of todo) {
    if (Date.now() > deadline || !s.topCardId) break;
    let en = "-";
    try {
      const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(s.topCardId)}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) { const d: any = await res.json(); en = baseSpeciesName(String(d?.name || "")).slice(0, 80) || "-"; }
      else if (res.status !== 404) continue;
    } catch { continue; }
    await db.update(pokemonSpecies).set({ nameEn: en }).where(eq(pokemonSpecies.dexId, s.dexId));
    done++;
  }
  return done;
}

/** Vergibt fehlende Slugs für Sealed-Produkte (für /sealed/<name>). */
export async function backfillSealedSlugs() {
  const list = await db.select({ id: sealedProducts.id, name: sealedProducts.name }).from(sealedProducts).where(isNull(sealedProducts.slug)).limit(200);
  for (const p of list) {
    const base = slugify(p.name);
    try { await db.update(sealedProducts).set({ slug: base }).where(eq(sealedProducts.id, p.id)); }
    catch { await db.update(sealedProducts).set({ slug: `${base}-${p.id}` }).where(eq(sealedProducts.id, p.id)).catch(() => {}); }
  }
  return list.length;
}

// ---------------------------------------------------------------------------
// Seiten
// ---------------------------------------------------------------------------
const tile = (x: any) => `<a class="ci" href="${h(cardLink(x))}">${x.image ? `<img src="${h(cdnImage(x.image, 200))}" alt="${h(x.name)} ${h(x.set_name || "")} ${h(x.local_id || "")}" loading="lazy" width="120" height="167">` : ""}
  <span>${h(x.name)}</span><span class="muted">${h(x.set_name || "")}${x.local_id ? ` #${h(x.local_id)}` : ""}</span><b>${Number(x.price) > 0 ? h(euro(Number(x.price))) : "–"}</b></a>`;

async function pokemonIndex(c: any) {
  if (!rateLimit(`seo:${clientIp(c)}`, 60, 60_000)) return c.text("Zu viele Anfragen", 429);
  const list = await db.select().from(pokemonSpecies).orderBy(asc(pokemonSpecies.nameDe)).limit(2000);
  const groups = new Map<string, typeof list>();
  for (const s of list) {
    const l = s.nameDe.charAt(0).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const k = /[A-Z]/.test(l) ? l : "#";
    groups.set(k, [...(groups.get(k) || []), s]);
  }
  const canonical = `${SITE()}/pokemon`;
  const top = [...list].filter((s) => Number(s.topPrice) > 0).sort((a, b) => Number(b.topPrice) - Number(a.topPrice)).slice(0, 12);
  const body = `${CSS}<p class="crumb"><a href="/">Start</a> › Pokémon A–Z</p><div class="card"><h1>Pokémon-Karten A–Z: Preise für jedes Pokémon</h1>
    <p class="muted">${list.length} Pokémon mit allen deutschen Sammelkarten, aktuellem Cardmarket-Preis und der jeweils wertvollsten Karte. Wähle dein Lieblings-Pokémon.</p>
    <div class="letters">${[...groups.keys()].map((k) => `<a href="#${k}">${k}</a>`).join("")}</div></div>
    ${top.length ? `<h2>💎 Die gefragtesten Pokémon nach Kartenwert</h2><div class="az">${top.map((s) => `<a href="/pokemon/${h(s.slug)}"><span>${h(s.nameDe)}</span><b style="color:#34d399">${h(euro(Number(s.topPrice)))}</b></a>`).join("")}</div>` : ""}
    ${[...groups].map(([k, items]) => `<h2 id="${k}">${k}</h2><div class="az">${items.map((s) => `<a href="/pokemon/${h(s.slug)}"><span>${h(s.nameDe)}</span><span class="muted">${s.cardCount}</span></a>`).join("")}</div>`).join("")
      || `<p class="muted">Die Pokémon-Liste wird gerade aus dem Kartenkatalog aufgebaut – bitte in Kürze erneut öffnen.</p>`}`;
  cacheHeaders(c, 900, 21600);
  return c.html(pageShell({
    title: "Pokémon-Karten A–Z – Preise & Wert jedes Pokémon | PokeSwipe & Radar",
    description: `Alle ${list.length || ""} Pokémon mit ihren deutschen Sammelkarten und aktuellen Cardmarket-Preisen: Was ist meine Glurak-, Pikachu- oder Mewtu-Karte wert?`,
    canonical, body,
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: "Pokémon-Karten A–Z", url: canonical, breadcrumb: crumbs([["Start", "/"], ["Pokémon A–Z", "/pokemon"]]) },
  }));
}

async function pokemonPage(c: any) {
  const slug = String(c.req.param("slug") || "").toLowerCase();
  const notFound = () => c.html(pageShell({ title: "Pokémon nicht gefunden | PokeSwipe & Radar", description: "", canonical: `${SITE()}/pokemon`, robots: "noindex",
    body: `<div class="card"><h1>Pokémon nicht gefunden</h1><a class="btn y" href="/pokemon">Pokémon A–Z</a></div>` }), 404);
  if (!/^[a-z0-9-]{1,70}$/.test(slug)) return notFound();
  if (!rateLimit(`seo:${clientIp(c)}`, 60, 60_000)) return c.text("Zu viele Anfragen", 429);
  const [sp] = await db.select().from(pokemonSpecies).where(eq(pokemonSpecies.slug, slug)).limit(1);
  if (!sp) return notFound();
  const list = rows(await db.execute(sql`
    SELECT c.id, c.name, c.image, c.local_id, c.set_name, c.set_id, c.rarity, c.types, c.hp,
      COALESCE(c.trend, c.avg, c.low)::float AS price, c.avg30::float AS avg30, s.release_date
    FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id
    WHERE c.dex_id = ${sp.dexId} LIMIT 600
  `));
  const priced = list.filter((x: any) => Number(x.price) > 0).sort((a: any, b: any) => b.price - a.price);
  const newest = [...list].sort((a: any, b: any) => String(b.release_date || "").localeCompare(String(a.release_date || ""))).slice(0, 12);
  const cheapest = [...priced].reverse().slice(0, 1)[0];
  const top = priced[0];
  const types = [...new Set(list.flatMap((x: any) => String(x.types || "").split(",").filter(Boolean)))];
  const en = sp.nameEn && sp.nameEn !== "-" && sp.nameEn.toLowerCase() !== sp.nameDe.toLowerCase() ? sp.nameEn : "";
  const canonical = `${SITE()}/pokemon/${sp.slug}`;
  const title = `${sp.nameDe} Karten – Wert & Preise aller ${list.length} Karten${en ? ` (${en})` : ""} | PokeSwipe & Radar`;
  const description = `Alle ${list.length} deutschen ${sp.nameDe}-Karten${en ? ` (engl. ${en})` : ""} mit aktuellem Cardmarket-Preis.${top ? ` Wertvollste: ${top.name} (${top.set_name}) für ${euro(top.price)}.` : ""} Preisverlauf, Preisalarm & Tauschangebote.`;
  const faq = [
    top && { q: `Was ist die wertvollste ${sp.nameDe}-Karte?`, a: `Aktuell ist ${top.name} aus ${top.set_name || "dem Pokémon TCG"} (Nr. ${top.local_id || "?"}) mit einem Cardmarket-Trendpreis von ${euro(top.price)} die wertvollste deutsche ${sp.nameDe}-Karte.` },
    { q: `Wie viele ${sp.nameDe}-Karten gibt es?`, a: `Im deutschen Katalog von PokeSwipe & Radar sind ${list.length} ${sp.nameDe}-Karten erfasst${priced.length ? `, ${priced.length} davon mit aktuellem Marktpreis` : ""}.` },
    cheapest && { q: `Wie viel ist eine ${sp.nameDe}-Karte wert?`, a: `Die Preise reichen von etwa ${euro(cheapest.price)} bis ${euro(top.price)}. Entscheidend sind Set, Seltenheit und Zustand – den genauen Wert deiner Karte siehst du auf der jeweiligen Kartenseite oder per KI-Kartenscan in der App.` },
  ].filter(Boolean) as { q: string; a: string }[];
  const body = `${CSS}<p class="crumb"><a href="/">Start</a> › <a href="/pokemon">Pokémon A–Z</a> › ${h(sp.nameDe)}</p>
  <div class="card">
    <h1>${h(sp.nameDe)}-Karten: alle Preise</h1>
    <p class="muted">Pokédex Nr. ${sp.dexId}${en ? ` • Englisch: ${h(en)}` : ""}${types.length ? ` • Typ: ${h(types.join(", "))}` : ""}</p>
    <div class="stats">
      <div class="stat">Karten<b>${list.length}</b></div>
      <div class="stat">Wertvollste<b>${top ? h(euro(top.price)) : "–"}</b></div>
      <div class="stat">Mit Preis<b>${priced.length}</b></div>
    </div>
    <div class="btns">
      <a class="btn y" href="/?tab=swipe&sub=search&search=${encodeURIComponent(sp.nameDe)}">🎯 Preisalarm für ${h(sp.nameDe)}</a>
      <a class="btn" style="background:#4f46e5;color:#fff" href="${h(cardmarketSearch(sp.nameDe))}" target="_blank" rel="noopener sponsored">Bei Cardmarket ansehen</a>
      <a class="btn" style="background:#2563eb;color:#fff" href="${h(ebayUrl(`Pokemon ${sp.nameDe} Karte`, "pokemon"))}" target="_blank" rel="noopener sponsored">🛒 Bei eBay*</a>
    </div>
  </div>
  ${priced.length ? `<h2>💎 Die wertvollsten ${h(sp.nameDe)}-Karten</h2><div class="cards">${priced.slice(0, 24).map(tile).join("")}</div>` : ""}
  ${newest.length ? `<h2>🆕 Neueste ${h(sp.nameDe)}-Karten</h2><div class="cards">${newest.map(tile).join("")}</div>` : ""}
  ${list.length > 24 ? `<h2>📋 Alle ${h(sp.nameDe)}-Karten</h2><div class="cards">${[...list].sort((a: any, b: any) => String(a.set_name).localeCompare(String(b.set_name), "de")).map(tile).join("")}</div>` : ""}
  ${faq.length ? `<h2>❓ Häufige Fragen zu ${h(sp.nameDe)}-Karten</h2>${faq.map((f) => `<details><summary>${h(f.q)}</summary><p class="muted">${h(f.a)}</p></details>`).join("")}` : ""}`;
  const jsonLd: object[] = [
    { "@context": "https://schema.org", "@type": "CollectionPage", name: `${sp.nameDe}-Karten`, url: canonical, description,
      breadcrumb: crumbs([["Start", "/"], ["Pokémon A–Z", "/pokemon"], [sp.nameDe, `/pokemon/${sp.slug}`]]),
      mainEntity: { "@type": "ItemList", numberOfItems: Math.min(10, priced.length),
        itemListElement: priced.slice(0, 10).map((x: any, i: number) => ({ "@type": "ListItem", position: i + 1, url: `${SITE()}${cardLink(x)}`, name: `${x.name} (${x.set_name})` })) } },
  ];
  if (faq.length) jsonLd.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  cacheHeaders(c);
  return c.html(pageShell({ title, description, canonical, body, jsonLd,
    image: top?.image ? `${SITE()}${cdnImage(String(top.image).replace(/\/high\.webp$/, "/high.png"), 600, "jpg")}` : undefined }));
}

const sealedQuery = (where = sql`TRUE`) => db.execute(sql`
  SELECT s.id, s.name, s.slug, s.set_name, s.set_id, s.kind, s.image, s.ref_price::float AS ref_price, s.ref_updated_at, s.uvp::float AS uvp,
    s.ean, s.release_date, s.cardmarket_url, s.contents, s.booster_count, s.description,
    (SELECT avg(l.price)::float FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS community_avg,
    (SELECT min(l.price)::float FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS community_min,
    (SELECT max(l.price)::float FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS community_max,
    (SELECT count(*)::int FROM listings l WHERE l.sealed_product_id = s.id AND l.status = 'active') AS listing_count,
    (SELECT COALESCE(h.ref_price, h.community_avg)::float FROM sealed_price_history h
       WHERE h.product_id = s.id AND h.day <= CURRENT_DATE - 30 ORDER BY h.day DESC LIMIT 1) AS price_30d
  FROM sealed_products s WHERE s.active AND ${where}
  ORDER BY s.release_date DESC NULLS LAST, s.kind, s.name
`);
const sealedPrice = (p: any) => Number(p.ref_price ?? p.community_avg ?? 0) || 0;
const uvpBadge = (p: any) => {
  const price = sealedPrice(p);
  if (!price || !p.uvp) return "";
  const r = price / p.uvp;
  return r <= 1.05 ? `<span class="pill deal">≈ UVP</span>` : r <= 1.4 ? `<span class="pill fair">+${Math.round((r - 1) * 100)} % über UVP</span>` : `<span class="pill high">+${Math.round((r - 1) * 100)} % über UVP</span>`;
};

async function sealedIndex(c: any) {
  if (!rateLimit(`seo:${clientIp(c)}`, 60, 60_000)) return c.text("Zu viele Anfragen", 429);
  const list = rows(await sealedQuery());
  const groups = new Map<string, any[]>();
  for (const p of list) groups.set(p.kind, [...(groups.get(p.kind) || []), p]);
  const canonical = `${SITE()}/sealed`;
  const body = `${CSS}<p class="crumb"><a href="/">Start</a> › Displays &amp; Sealed</p><div class="card"><h1>Pokémon Displays, ETBs &amp; Boxen: aktuelle Preise</h1>
    <p class="muted">${list.length} versiegelte Produkte mit Marktpreis, UVP-Vergleich und Preis pro Booster. Mit Restock-Alarm verpasst du keinen Display-Drop zum UVP mehr.</p>
    <div class="btns"><a class="btn y" href="/?tab=flip&sub=drops">🚨 Restock-Alarm aktivieren</a><a class="btn s" href="/ratgeber/pokemon-displays-zum-uvp">Ratgeber: Displays zum UVP</a></div></div>
    ${[...groups].map(([kind, items]) => `<h2>${h(KIND_LABEL[kind] || kind)}s</h2><div class="list">${items.map((p: any) => `<a class="row" style="text-decoration:none" href="/sealed/${h(sealedSlug(p))}">
      <span><b>${h(p.name)}</b> <span class="muted">${p.set_name ? `• ${h(p.set_name)}` : ""}</span></span><span>${uvpBadge(p)} <b style="color:#34d399">${sealedPrice(p) ? h(euro(sealedPrice(p))) : "–"}</b></span></a>`).join("")}</div>`).join("")
      || `<p class="muted">Noch keine Produkte im Katalog.</p>`}`;
  cacheHeaders(c);
  return c.html(pageShell({
    title: "Pokémon Displays & ETB Preise aktuell – Marktpreis vs. UVP | PokeSwipe & Radar",
    description: "Aktuelle Preise für Pokémon-Displays, Elite-Trainer-Boxen und Top-Trainer-Boxen auf Deutsch: Marktpreis, UVP, Preis pro Booster und Restock-Alarm.",
    canonical, body,
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: "Pokémon Displays & Sealed-Produkte", url: canonical, breadcrumb: crumbs([["Start", "/"], ["Displays & Sealed", "/sealed"]]) },
  }));
}

async function sealedPage(c: any) {
  const slug = String(c.req.param("slug") || "").toLowerCase();
  const notFound = () => c.html(pageShell({ title: "Produkt nicht gefunden | PokeSwipe & Radar", description: "", canonical: `${SITE()}/sealed`, robots: "noindex",
    body: `<div class="card"><h1>Produkt nicht gefunden</h1><a class="btn y" href="/sealed">Alle Displays &amp; Boxen</a></div>` }), 404);
  if (!/^[a-z0-9-]{1,90}$/.test(slug)) return notFound();
  if (!rateLimit(`seo:${clientIp(c)}`, 60, 60_000)) return c.text("Zu viele Anfragen", 429);
  const idMatch = /^(\d{1,9})-/.exec(slug);
  let [p] = rows(await sealedQuery(sql`s.slug = ${slug}`));
  if (!p && idMatch) [p] = rows(await sealedQuery(sql`s.id = ${Number(idMatch[1])}`));
  if (!p) return notFound();
  const price = sealedPrice(p);
  const hist = rows(await db.execute(sql`SELECT COALESCE(ref_price, community_avg)::float AS v FROM sealed_price_history WHERE product_id = ${p.id} ORDER BY day DESC LIMIT 120`)).reverse();
  const offers = rows(await db.execute(sql`
    SELECT l.price::float AS price, l.city, p.display_name FROM listings l JOIN profiles p ON p.user_id = l.user_id
    WHERE l.sealed_product_id = ${p.id} AND l.status = 'active' AND NOT p.banned ORDER BY l.price ASC LIMIT 10
  `));
  const ch30 = price && p.price_30d ? ((price - p.price_30d) / p.price_30d) * 100 : null;
  const perBooster = price && Number(p.booster_count) > 0 ? price / Number(p.booster_count) : null;
  const canonical = `${SITE()}/sealed/${sealedSlug(p)}`;
  const kind = KIND_LABEL[p.kind] || "Produkt";
  const title = `${p.name} – Preis aktuell${price ? ` ${euro(price)}` : ""}${p.uvp ? ` (UVP ${euro(p.uvp)})` : ""} | PokeSwipe & Radar`;
  const description = `${p.name}${p.set_name ? ` (${p.set_name})` : ""}: aktueller Marktpreis ${price ? euro(price) : "–"}${p.uvp ? `, UVP ${euro(p.uvp)}` : ""}${perBooster ? `, ${euro(perBooster)} pro Booster` : ""}. Preisverlauf, Restock-Alarm und Angebote aus der Community.`;
  const body = `${CSS}<p class="crumb"><a href="/">Start</a> › <a href="/sealed">Displays &amp; Sealed</a> › ${h(p.name)}</p>
  <div class="card"><div class="grid">
    <div>${p.image ? `<img class="img" src="${h(cdnImage(p.image, 520))}" alt="${h(p.name)}" width="260">` : `<p style="font-size:80px;text-align:center;margin:0">📦</p>`}</div>
    <div>
      <h1>${h(p.name)}</h1>
      <p class="muted">${[kind, p.set_name, p.release_date ? `Erschienen ${new Date(p.release_date).toLocaleDateString("de-DE")}` : "", p.ean ? `EAN ${p.ean}` : ""].filter(Boolean).map(h).join(" • ")}</p>
      <p class="price">${price ? h(euro(price)) : "Noch kein Preis"}</p>
      <p class="muted">${p.ref_price ? "Marktpreis (Referenz)" : p.community_avg ? "Ø Community-Angebote" : ""}${ch30 !== null ? ` • <span class="${ch30 >= 0 ? "up" : "down"}">${ch30 >= 0 ? "+" : ""}${ch30.toFixed(1).replace(".", ",")} % (30 Tage)</span>` : ""} ${uvpBadge(p)}</p>
      <div class="stats">
        <div class="stat">UVP<b>${p.uvp ? h(euro(p.uvp)) : "–"}</b></div>
        <div class="stat">Pro Booster<b>${perBooster ? h(euro(perBooster)) : "–"}</b></div>
        <div class="stat">Angebote<b>${Number(p.listing_count) || 0}</b></div>
      </div>
      ${p.contents ? `<p class="muted">Inhalt: ${h(p.contents)}</p>` : ""}
      ${chartSvg(hist.map((x: any) => Number(x.v)))}
      <div class="btns">
        <a class="btn y" href="/?tab=flip&sub=drops">🚨 Restock-Alarm</a>
        <a class="btn g" href="/?sealed=${Number(p.id)}">🎯 Preisalarm setzen</a>
        <a class="btn" style="background:#4f46e5;color:#fff" href="${h(p.cardmarket_url || cardmarketSearch(p.name))}" target="_blank" rel="noopener sponsored">Bei Cardmarket ansehen</a>
        <a class="btn" style="background:#2563eb;color:#fff" href="${h(ebayUrl(`${p.name} Pokemon OVP`, "sealed"))}" target="_blank" rel="noopener sponsored">🛒 Bei eBay*</a>
      </div>
    </div></div></div>
  ${p.description ? `<h2>Über das Produkt</h2><p class="muted">${h(p.description)}</p>` : ""}
  <h2>🤝 Angebote aus der Community</h2>
  ${offers.length ? `<div class="list">${offers.map((o: any) => `<div class="row"><span><b>${h(euro(o.price))}</b> <span class="muted">• ${h(o.city)} • ${h(o.display_name)}</span></span></div>`).join("")}</div>`
    : `<p class="muted">Gerade keine Angebote. Aktiviere den Restock-Alarm, um Drops zum UVP sofort mitzubekommen.</p>`}
  ${p.set_id ? `<p style="margin-top:14px"><a class="btn s" href="/set/${encodeURIComponent(p.set_id)}/${slugify(p.set_name || p.set_id)}">📋 Kartenliste &amp; Preise des Sets</a></p>` : ""}`;
  const jsonLd: any = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, category: `Pokémon TCG ${kind}`, brand: { "@type": "Brand", name: "Pokémon TCG" },
    ...(p.ean ? { gtin13: p.ean } : {}), ...(p.image ? { image: p.image } : {}), ...(p.description ? { description: p.description } : {}),
    ...(offers.length ? { offers: { "@type": "AggregateOffer", priceCurrency: "EUR", offerCount: offers.length,
      lowPrice: Number(p.community_min).toFixed(2), highPrice: Number(p.community_max).toFixed(2) } } : {}),
  };
  cacheHeaders(c, 300, 1800);
  return c.html(pageShell({ title, description, canonical, body, jsonLd: [jsonLd, { "@context": "https://schema.org", ...crumbs([["Start", "/"], ["Displays & Sealed", "/sealed"], [p.name, `/sealed/${sealedSlug(p)}`]]) }],
    image: p.image ? `${SITE()}${cdnImage(p.image, 600, "jpg")}` : undefined }));
}

async function trendsPage(c: any) {
  if (!rateLimit(`seo:${clientIp(c)}`, 60, 60_000)) return c.text("Zu viele Anfragen", 429);
  const movers = (dir: "up" | "down") => db.execute(sql`
    SELECT id, name, image, set_name, local_id, COALESCE(trend, avg)::float AS price,
      ((COALESCE(trend, avg) - avg30) / avg30 * 100)::float AS change
    FROM cards WHERE avg30 >= 3 AND COALESCE(trend, avg) >= 3 AND price_updated_at > now() - interval '10 days'
    ORDER BY change ${dir === "up" ? sql`DESC` : sql`ASC`} LIMIT 24
  `);
  const [up, down, wanted] = await Promise.all([
    movers("up").then(rows), movers("down").then(rows),
    db.execute(sql`
      SELECT c.id, c.name, c.image, c.set_name, c.local_id, COALESCE(c.trend, c.avg, c.low)::float AS price, count(w.id)::int AS wishers
      FROM wishlist_items w JOIN cards c ON c.id = w.card_id GROUP BY c.id ORDER BY wishers DESC LIMIT 12
    `).then(rows),
  ]);
  const ch = (x: any) => `<span class="${x.change >= 0 ? "up" : "down"}">${x.change >= 0 ? "+" : ""}${Number(x.change).toFixed(1).replace(".", ",")} %</span>`;
  const t = (x: any) => tile(x).replace("</b></a>", `</b>${x.change !== undefined ? ch(x) : x.wishers ? `<span class="muted">❤️ ${x.wishers} suchen</span>` : ""}</a>`);
  const month = new Date().toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const canonical = `${SITE()}/trends`;
  const body = `${CSS}<p class="crumb"><a href="/">Start</a> › Preis-Trends</p><div class="card"><h1>Pokémon-Karten Preis-Trends ${h(month)}</h1>
    <p class="muted">Welche Pokémon-Karten steigen gerade im Wert, welche fallen? Vergleich des aktuellen Cardmarket-Trends mit dem 30-Tage-Durchschnitt (Karten ab 3 €). Täglich aktualisiert.</p>
    <div class="btns"><a class="btn y" href="/?tab=portfolio">💼 Eigene Sammlung bewerten</a><a class="btn s" href="/sets">Alle Sets</a></div></div>
    ${up.length ? `<h2>📈 Größte Gewinner (30 Tage)</h2><div class="cards">${up.map(t).join("")}</div>` : `<p class="muted">Die Trends bauen sich gerade auf.</p>`}
    ${down.length ? `<h2>📉 Größte Verlierer (30 Tage)</h2><div class="cards">${down.map(t).join("")}</div>` : ""}
    ${wanted.length ? `<h2>❤️ Meistgesuchte Karten der Community</h2><div class="cards">${wanted.map(t).join("")}</div>` : ""}`;
  cacheHeaders(c, 900, 3600);
  return c.html(pageShell({
    title: `Pokémon-Karten Preis-Trends ${month}: Gewinner & Verlierer | PokeSwipe & Radar`,
    description: `Welche Pokémon-Karten steigen im Wert? Die größten Preis-Gewinner und -Verlierer der letzten 30 Tage nach Cardmarket-Trend${up[0] ? ` – vorne: ${up[0].name} (+${Number(up[0].change).toFixed(0)} %)` : ""}.`,
    canonical, body,
    jsonLd: { "@context": "https://schema.org", "@type": "ItemList", name: `Pokémon-Karten Preis-Gewinner ${month}`, url: canonical,
      itemListElement: up.slice(0, 10).map((x: any, i: number) => ({ "@type": "ListItem", position: i + 1, url: `${SITE()}${cardLink(x)}`, name: x.name })) },
  }));
}

// ---------------------------------------------------------------------------
// Sitemaps & Routen (vor registerCatalog registrieren, damit /sitemaps/pokemon.xml nicht im Karten-Muster landet)
// ---------------------------------------------------------------------------
const xml = (c: any, body: string) => {
  c.header("Cache-Control", "public, max-age=3600");
  c.header("Netlify-CDN-Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, 200, { "Content-Type": "application/xml; charset=utf-8" });
};
const loc = (path: string, lastmod?: unknown, extra = "<changefreq>daily</changefreq>") =>
  `<url><loc>${h(`${SITE()}${path}`)}</loc>${lastmod ? `<lastmod>${new Date(String(lastmod)).toISOString().slice(0, 10)}</lastmod>` : ""}${extra}</url>`;

export const SEO_SITEMAPS = ["/sitemaps/pokemon.xml", "/sitemaps/sealed.xml"];
export const SEO_STATIC_PAGES = ["/pokemon", "/sealed", "/trends"];

export function registerSeo(app: any) {
  app.get("/pokemon", pokemonIndex);
  app.get("/pokemon/:slug", pokemonPage);
  app.get("/sealed", sealedIndex);
  app.get("/sealed/:slug", sealedPage);
  app.get("/trends", trendsPage);

  app.get("/sitemaps/pokemon.xml", async (c: any) => {
    const list = await db.select({ slug: pokemonSpecies.slug, updatedAt: pokemonSpecies.updatedAt }).from(pokemonSpecies).orderBy(asc(pokemonSpecies.dexId)).limit(5000);
    return xml(c, list.map((s) => loc(`/pokemon/${s.slug}`, s.updatedAt, "<changefreq>daily</changefreq><priority>0.7</priority>")).join(""));
  });
  app.get("/sitemaps/sealed.xml", async (c: any) => {
    const list = rows(await db.execute(sql`SELECT id, slug, name, COALESCE(ref_updated_at, created_at) AS updated FROM sealed_products WHERE active ORDER BY id LIMIT 5000`));
    return xml(c, list.map((p: any) => loc(`/sealed/${sealedSlug(p)}`, p.updated, "<changefreq>daily</changefreq><priority>0.6</priority>")).join(""));
  });

  /** Für die Kartenseite: Link „Alle Karten von …“. */
  app.get("/api/catalog/species/:dexId", async (c: any) => {
    const dex = Number(c.req.param("dexId"));
    if (!Number.isInteger(dex) || dex < 1 || dex > 2000) return c.json({ error: "Ungültig" }, 400);
    const [sp] = await db.select().from(pokemonSpecies).where(eq(pokemonSpecies.dexId, dex)).limit(1);
    c.header("Cache-Control", "public, max-age=3600");
    return sp ? c.json({ species: sp }) : c.json({ error: "Nicht gefunden" }, 404);
  });
}
