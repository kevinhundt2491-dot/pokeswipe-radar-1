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
import { SITE, h, slugify, cdnImage, pageShell, ebayUrl, cardmarketSearch, chartSvg, englishCardNames } from "./growth.ts";
import { pt, euroL, fmtPct, fmtDate, localPath, langFromPath, alternatesFor, withAppLang, displayName, pokemonEnSlug, typeLabel, KIND_LABELS, kindHeading, type Lang } from "./page-i18n.ts";
import { rows, rateLimit, clientIp, euro } from "./util.ts";
import { baseSpeciesName } from "./logic.ts";
import { publicCache } from "./cache.ts";
import { resilientFetch, CircuitOpenError } from "./resilience.ts";

export { baseSpeciesName };

const SPECIES_REFRESH_MS = 6 * 3600_000;
/** Öffentliche SEO-Seiten ohne Login-/Cookie-Bezug: CDN-Cache (s. server/cache.ts). */
const cacheHeaders = (c: any) => publicCache(c, "page");
const crumbs = (items: [string, string][]) => ({
  "@type": "BreadcrumbList",
  itemListElement: items.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE()}${path}` })),
});
const cardLink = (x: { id: string; name: string }, lang: Lang = "de") => localPath(lang, `/karte/${encodeURIComponent(x.id)}/${slugify(x.name)}`);
const sealedSlug = (p: { id: number; slug: string | null; name: string }) => p.slug || `${p.id}-${slugify(p.name)}`;
const tr = (lang: Lang) => (k: Parameters<typeof pt>[1], v?: Record<string, string | number>) => pt(lang, k, v);
const canon = (lang: Lang, alt: { de: string; en: string }) => `${SITE()}${lang === "en" ? alt.en : alt.de}`;
/** Ersetzt in Kartenzeilen Name/Set-Name durch den englischen Druck (nur englische Seiten). */
async function localizeCards<T extends { id: string; name: string; set_name?: string }>(lang: Lang, list: T[]): Promise<T[]> {
  if (lang !== "en" || !list.length) return list;
  const en = await englishCardNames(list.map((x) => String(x.id)));
  return list.map((x) => {
    const e = en.get(String(x.id));
    return e ? { ...x, name: e.name, set_name: e.setName || x.set_name } : x;
  });
}
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
      const res = await resilientFetch("tcgdex", `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(s.topCardId)}`, {}, { timeoutMs: 5000, attempts: 2 });
      if (res.ok) { const d: any = await res.json(); en = baseSpeciesName(String(d?.name || "")).slice(0, 80) || "-"; }
      else if (res.status !== 404) continue;
    } catch (e) { if (e instanceof CircuitOpenError) break; continue; }
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
const tile = (x: any, lang: Lang = "de") => `<a class="ci" href="${h(cardLink(x, lang))}">${x.image ? `<img src="${h(cdnImage(x.image, 200))}" alt="${h(x.name)} ${h(x.set_name || "")} ${h(x.local_id || "")}" loading="lazy" width="120" height="167">` : ""}
  <span>${h(x.name)}</span><span class="muted">${h(x.set_name || "")}${x.local_id ? ` #${h(x.local_id)}` : ""}</span><b>${Number(x.price) > 0 ? h(euroL(lang, Number(x.price))) : "–"}</b></a>`;

/** Slug einer Pokémon-Art in der Seitensprache. */
const speciesSlug = (lang: Lang, s: { slug: string; nameEn: string }) => (lang === "en" ? pokemonEnSlug(s.nameEn, s.slug) : s.slug);
const speciesAlternates = (s: { slug: string; nameEn: string }) => alternatesFor(`/pokemon/${s.slug}`, `/pokemon/${pokemonEnSlug(s.nameEn, s.slug)}`);

async function pokemonIndex(c: any) {
  const lang = langFromPath(c.req.path);
  const t = tr(lang), lp = (p: string) => localPath(lang, p), eur = (n: number) => euroL(lang, n);
  if (!(await rateLimit(`seo:${clientIp(c)}`, 60, 60_000))) return c.text(t("common.tooMany"), 429);
  const raw = await db.select().from(pokemonSpecies).orderBy(asc(pokemonSpecies.nameDe)).limit(2000);
  const nm = (s: typeof raw[number]) => displayName(lang, s.nameDe, s.nameEn);
  const list = lang === "en" ? [...raw].sort((a, b) => nm(a).localeCompare(nm(b), "en")) : raw;
  const groups = new Map<string, typeof list>();
  for (const s of list) {
    const l = nm(s).charAt(0).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const k = /[A-Z]/.test(l) ? l : "#";
    groups.set(k, [...(groups.get(k) || []), s]);
  }
  const alternates = alternatesFor("/pokemon");
  const canonical = canon(lang, alternates);
  const href = (s: typeof raw[number]) => lp(`/pokemon/${h(speciesSlug(lang, s))}`);
  const top = [...list].filter((s) => Number(s.topPrice) > 0).sort((a, b) => Number(b.topPrice) - Number(a.topPrice)).slice(0, 12);
  const body = `${CSS}<p class="crumb"><a href="${h(lp("/"))}">${t("crumb.start")}</a> › ${t("crumb.pokemon")}</p><div class="card"><h1>${t("poke.indexH1")}</h1>
    <p class="muted">${t("poke.indexIntro", { n: list.length })}</p>
    <div class="letters">${[...groups.keys()].map((k) => `<a href="#${k}">${k}</a>`).join("")}</div></div>
    ${top.length ? `<h2>${t("poke.indexTop")}</h2><div class="az">${top.map((s) => `<a href="${href(s)}"><span>${h(nm(s))}</span><b style="color:#34d399">${h(eur(Number(s.topPrice)))}</b></a>`).join("")}</div>` : ""}
    ${[...groups].map(([k, items]) => `<h2 id="${k}">${k}</h2><div class="az">${items.map((s) => `<a href="${href(s)}"><span>${h(nm(s))}</span><span class="muted">${s.cardCount}</span></a>`).join("")}</div>`).join("")
      || `<p class="muted">${t("poke.indexBuilding")}</p>`}`;
  cacheHeaders(c);
  return c.html(pageShell({
    lang, alternates,
    title: t("poke.indexTitle"),
    description: t("poke.indexDesc", { n: list.length || "" }),
    canonical, body,
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: t("poke.indexLdName"), url: canonical, ...(lang === "en" ? { inLanguage: "en" } : {}),
      breadcrumb: crumbs([[t("crumb.start"), lp("/")], [t("crumb.pokemon"), lp("/pokemon")]]) },
  }));
}

/** Englische Seite: zuerst über den englischen Namen suchen, sonst über den deutschen Slug. */
async function findSpecies(lang: Lang, slug: string) {
  if (lang === "en") {
    const byEn = await db.select().from(pokemonSpecies)
      .where(sql`trim(both '-' from regexp_replace(lower(${pokemonSpecies.nameEn}), '[^a-z0-9]+', '-', 'g')) = ${slug}`)
      .orderBy(asc(pokemonSpecies.dexId)).limit(5);
    const hit = byEn.find((s) => pokemonEnSlug(s.nameEn, s.slug) === slug);
    if (hit) return hit;
  }
  const [sp] = await db.select().from(pokemonSpecies).where(eq(pokemonSpecies.slug, slug)).limit(1);
  return sp;
}

async function pokemonPage(c: any) {
  const lang = langFromPath(c.req.path);
  const t = tr(lang), lp = (p: string) => localPath(lang, p), eur = (n: number) => euroL(lang, n);
  const slug = String(c.req.param("slug") || "").toLowerCase();
  const notFound = () => c.html(pageShell({ lang, title: `${t("poke.notFound")} | PokeSwipe & Radar`, description: "", canonical: `${SITE()}${lp("/pokemon")}`, robots: "noindex",
    body: `<div class="card"><h1>${t("poke.notFound")}</h1><a class="btn y" href="${lp("/pokemon")}">${t("crumb.pokemon")}</a></div>` }), 404);
  if (!/^[a-z0-9-]{1,70}$/.test(slug)) return notFound();
  if (!(await rateLimit(`seo:${clientIp(c)}`, 60, 60_000))) return c.text(t("common.tooMany"), 429);
  const sp = await findSpecies(lang, slug);
  if (!sp) return notFound();
  // Englische Seite über den deutschen Slug aufgerufen → auf den englischen Slug umleiten
  if (lang === "en" && speciesSlug("en", sp) !== slug) return c.redirect(`/en/pokemon/${speciesSlug("en", sp)}`, 301);
  const list = await localizeCards(lang, rows(await db.execute(sql`
    SELECT c.id, c.name, c.image, c.local_id, c.set_name, c.set_id, c.rarity, c.types, c.hp,
      COALESCE(c.trend, c.avg, c.low)::float AS price, c.avg30::float AS avg30, s.release_date
    FROM cards c LEFT JOIN card_sets s ON s.id = c.set_id
    WHERE c.dex_id = ${sp.dexId} LIMIT 600
  `)));
  const priced = list.filter((x: any) => Number(x.price) > 0).sort((a: any, b: any) => b.price - a.price);
  const newest = [...list].sort((a: any, b: any) => String(b.release_date || "").localeCompare(String(a.release_date || ""))).slice(0, 12);
  const cheapest = [...priced].reverse().slice(0, 1)[0];
  const top = priced[0];
  const types = [...new Set(list.flatMap((x: any) => String(x.types || "").split(",").filter(Boolean)))].map((x) => typeLabel(lang, x));
  const en = sp.nameEn && sp.nameEn !== "-" && sp.nameEn.toLowerCase() !== sp.nameDe.toLowerCase() ? sp.nameEn : "";
  // Hauptname und Zweitname (Deutsch: engl. Name; Englisch: deutscher Name)
  const name = lang === "en" ? displayName("en", sp.nameDe, sp.nameEn) : sp.nameDe;
  const alt = lang === "en" ? (en ? sp.nameDe : "") : en;
  const alternates = speciesAlternates(sp);
  const canonical = canon(lang, alternates);
  const ownPath = lang === "en" ? alternates.en : alternates.de;
  const title = t("poke.title", { name, n: list.length, alt: alt ? t("poke.titleAlt", { name: alt }) : "" });
  const description = t("poke.desc", { n: list.length, name, alt: alt ? t("poke.descAlt", { name: alt }) : "",
    top: top ? t("poke.descTop", { name: top.name, set: top.set_name, price: eur(top.price) }) : "" });
  const faq = [
    top && { q: t("poke.faqTopQ", { name }), a: t("poke.faqTopA", { card: top.name, set: top.set_name || t("poke.tcgFallback"), no: top.local_id || "?", price: eur(top.price), name }) },
    { q: t("poke.faqCountQ", { name }), a: t("poke.faqCountA", { n: list.length, name, priced: priced.length ? t("poke.faqCountPriced", { n: priced.length }) : "" }) },
    cheapest && { q: t("poke.faqValueQ", { name }), a: t("poke.faqValueA", { min: eur(cheapest.price), max: eur(top.price) }) },
  ].filter(Boolean) as { q: string; a: string }[];
  const tl = (x: any) => tile(x, lang);
  const body = `${CSS}<p class="crumb"><a href="${h(lp("/"))}">${t("crumb.start")}</a> › <a href="${lp("/pokemon")}">${t("crumb.pokemon")}</a> › ${h(name)}</p>
  <div class="card">
    <h1>${t("poke.h1", { name: h(name) })}</h1>
    <p class="muted">${t("poke.dex", { n: sp.dexId })}${alt ? t("poke.altName", { name: h(alt) }) : ""}${types.length ? t("poke.types", { t: h(types.join(", ")) }) : ""}</p>
    <div class="stats">
      <div class="stat">${t("poke.cards")}<b>${list.length}</b></div>
      <div class="stat">${t("poke.mostValuable")}<b>${top ? h(eur(top.price)) : "–"}</b></div>
      <div class="stat">${t("poke.priced")}<b>${priced.length}</b></div>
    </div>
    <div class="btns">
      <a class="btn y" href="${lang === "en" ? h(withAppLang("en", `/?tab=swipe&sub=search&search=${encodeURIComponent(sp.nameDe)}`)) : `/?tab=swipe&sub=search&search=${encodeURIComponent(sp.nameDe)}`}">${t("poke.alert", { name: h(name) })}</a>
      <a class="btn" style="background:#4f46e5;color:#fff" href="${h(cardmarketSearch(name, lang))}" target="_blank" rel="noopener sponsored">${t("common.cardmarket")}</a>
      <a class="btn" style="background:#2563eb;color:#fff" href="${h(ebayUrl(t("poke.ebayQuery", { name }), "pokemon"))}" target="_blank" rel="noopener sponsored">${t("common.ebay")}</a>
    </div>
  </div>
  ${priced.length ? `<h2>${t("poke.hTop", { name: h(name) })}</h2><div class="cards">${priced.slice(0, 24).map(tl).join("")}</div>` : ""}
  ${newest.length ? `<h2>${t("poke.hNew", { name: h(name) })}</h2><div class="cards">${newest.map(tl).join("")}</div>` : ""}
  ${list.length > 24 ? `<h2>${t("poke.hAll", { name: h(name) })}</h2><div class="cards">${[...list].sort((a: any, b: any) => String(a.set_name).localeCompare(String(b.set_name), lang)).map(tl).join("")}</div>` : ""}
  ${faq.length ? `<h2>${t("poke.hFaq", { name: h(name) })}</h2>${faq.map((f) => `<details><summary>${h(f.q)}</summary><p class="muted">${h(f.a)}</p></details>`).join("")}` : ""}`;
  const jsonLd: object[] = [
    { "@context": "https://schema.org", "@type": "CollectionPage", name: t("poke.ldName", { name }), url: canonical, description, ...(lang === "en" ? { inLanguage: "en" } : {}),
      breadcrumb: crumbs([[t("crumb.start"), lp("/")], [t("crumb.pokemon"), lp("/pokemon")], [name, ownPath]]),
      mainEntity: { "@type": "ItemList", numberOfItems: Math.min(10, priced.length),
        itemListElement: priced.slice(0, 10).map((x: any, i: number) => ({ "@type": "ListItem", position: i + 1, url: `${SITE()}${cardLink(x, lang)}`, name: `${x.name} (${x.set_name})` })) } },
  ];
  if (faq.length) jsonLd.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  cacheHeaders(c);
  return c.html(pageShell({ lang, alternates, title, description, canonical, body, jsonLd,
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
const uvpBadge = (p: any, lang: Lang = "de") => {
  const price = sealedPrice(p);
  if (!price || !p.uvp) return "";
  const r = price / p.uvp;
  const over = pt(lang, "sealed.overUvp", { change: fmtPct(lang, Math.round((r - 1) * 100), 0) });
  return r <= 1.05 ? `<span class="pill deal">${pt(lang, "sealed.atUvp")}</span>` : r <= 1.4 ? `<span class="pill fair">${over}</span>` : `<span class="pill high">${over}</span>`;
};

async function sealedIndex(c: any) {
  const lang = langFromPath(c.req.path);
  const t = tr(lang), lp = (p: string) => localPath(lang, p), eur = (n: number) => euroL(lang, n);
  if (!(await rateLimit(`seo:${clientIp(c)}`, 60, 60_000))) return c.text(t("common.tooMany"), 429);
  const list = rows(await sealedQuery());
  const groups = new Map<string, any[]>();
  for (const p of list) groups.set(p.kind, [...(groups.get(p.kind) || []), p]);
  const alternates = alternatesFor("/sealed");
  const canonical = canon(lang, alternates);
  const body = `${CSS}<p class="crumb"><a href="${h(lp("/"))}">${t("crumb.start")}</a> › ${t("sealed.crumbHtml")}</p><div class="card"><h1>${t("sealed.indexH1")}</h1>
    <p class="muted">${t("sealed.indexIntro", { n: list.length })}</p>
    <div class="btns"><a class="btn y" href="${h(lp("/?tab=flip&sub=drops"))}">${t("sealed.restockOn")}</a><a class="btn s" href="/ratgeber/pokemon-displays-zum-uvp">${t("sealed.guide")}</a></div></div>
    ${[...groups].map(([kind, items]) => `<h2>${h(kindHeading(lang, kind))}</h2><div class="list">${items.map((p: any) => `<a class="row" style="text-decoration:none" href="${lp(`/sealed/${h(sealedSlug(p))}`)}">
      <span><b>${h(p.name)}</b> <span class="muted">${p.set_name ? `• ${h(p.set_name)}` : ""}</span></span><span>${uvpBadge(p, lang)} <b style="color:#34d399">${sealedPrice(p) ? h(eur(sealedPrice(p))) : "–"}</b></span></a>`).join("")}</div>`).join("")
      || `<p class="muted">${t("sealed.none")}</p>`}`;
  cacheHeaders(c);
  return c.html(pageShell({
    lang, alternates,
    title: t("sealed.indexTitle"),
    description: t("sealed.indexDesc"),
    canonical, body,
    jsonLd: { "@context": "https://schema.org", "@type": "CollectionPage", name: t("sealed.indexLdName"), url: canonical, ...(lang === "en" ? { inLanguage: "en" } : {}),
      breadcrumb: crumbs([[t("crumb.start"), lp("/")], [t("sealed.crumb"), lp("/sealed")]]) },
  }));
}

async function sealedPage(c: any) {
  const lang = langFromPath(c.req.path);
  const t = tr(lang), lp = (p: string) => localPath(lang, p), eur = (n: number) => euroL(lang, n);
  const slug = String(c.req.param("slug") || "").toLowerCase();
  const notFound = () => c.html(pageShell({ lang, title: `${t("sealed.notFound")} | PokeSwipe & Radar`, description: "", canonical: `${SITE()}${lp("/sealed")}`, robots: "noindex",
    body: `<div class="card"><h1>${t("sealed.notFound")}</h1><a class="btn y" href="${lp("/sealed")}">${t("sealed.all")}</a></div>` }), 404);
  if (!/^[a-z0-9-]{1,90}$/.test(slug)) return notFound();
  if (!(await rateLimit(`seo:${clientIp(c)}`, 60, 60_000))) return c.text(t("common.tooMany"), 429);
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
  const alternates = alternatesFor(`/sealed/${sealedSlug(p)}`);
  const canonical = canon(lang, alternates);
  const kind = KIND_LABELS[lang][p.kind] || t("sealed.product");
  const title = t("sealed.title", { name: p.name, price: price ? ` ${eur(price)}` : "", uvp: p.uvp ? t("sealed.titleUvp", { price: eur(p.uvp) }) : "" });
  const description = t("sealed.desc", { name: p.name, set: p.set_name ? ` (${p.set_name})` : "", price: price ? eur(price) : "–",
    uvp: p.uvp ? t("sealed.descUvp", { price: eur(p.uvp) }) : "", per: perBooster ? t("sealed.descPer", { price: eur(perBooster) }) : "" });
  const body = `${CSS}<p class="crumb"><a href="${h(lp("/"))}">${t("crumb.start")}</a> › <a href="${lp("/sealed")}">${t("sealed.crumbHtml")}</a> › ${h(p.name)}</p>
  <div class="card"><div class="grid">
    <div>${p.image ? `<img class="img" src="${h(cdnImage(p.image, 520))}" alt="${h(p.name)}" width="260">` : `<p style="font-size:80px;text-align:center;margin:0">📦</p>`}</div>
    <div>
      <h1>${h(p.name)}</h1>
      <p class="muted">${[kind, p.set_name, p.release_date ? t("sealed.released", { date: fmtDate(lang, p.release_date) }) : "", p.ean ? `EAN ${p.ean}` : ""].filter(Boolean).map(h).join(" • ")}</p>
      <p class="price">${price ? h(eur(price)) : t("sealed.noPrice")}</p>
      <p class="muted">${p.ref_price ? t("sealed.refPrice") : p.community_avg ? t("sealed.communityAvg") : ""}${ch30 !== null ? ` • <span class="${ch30 >= 0 ? "up" : "down"}">${t("common.change30", { change: fmtPct(lang, ch30, 1, true) })}</span>` : ""} ${uvpBadge(p, lang)}</p>
      <div class="stats">
        <div class="stat">${t("sealed.uvp")}<b>${p.uvp ? h(eur(p.uvp)) : "–"}</b></div>
        <div class="stat">${t("sealed.perBooster")}<b>${perBooster ? h(eur(perBooster)) : "–"}</b></div>
        <div class="stat">${t("sealed.offers")}<b>${Number(p.listing_count) || 0}</b></div>
      </div>
      ${p.contents ? `<p class="muted">${t("sealed.contents", { c: h(p.contents) })}</p>` : ""}
      ${chartSvg(hist.map((x: any) => Number(x.v)), 640, 160, lang)}
      <div class="btns">
        <a class="btn y" href="${h(lp("/?tab=flip&sub=drops"))}">${t("sealed.restock")}</a>
        <a class="btn g" href="${h(lp(`/?sealed=${Number(p.id)}`))}">${t("card.alert")}</a>
        <a class="btn" style="background:#4f46e5;color:#fff" href="${h(p.cardmarket_url || cardmarketSearch(p.name, lang))}" target="_blank" rel="noopener sponsored">${t("common.cardmarket")}</a>
        <a class="btn" style="background:#2563eb;color:#fff" href="${h(ebayUrl(`${p.name} Pokemon OVP`, "sealed"))}" target="_blank" rel="noopener sponsored">${t("common.ebay")}</a>
      </div>
    </div></div></div>
  ${p.description ? `<h2>${t("sealed.about")}</h2><p class="muted">${h(p.description)}</p>` : ""}
  <h2>${t("sealed.community")}</h2>
  ${offers.length ? `<div class="list">${offers.map((o: any) => `<div class="row"><span><b>${h(eur(o.price))}</b> <span class="muted">• ${h(o.city)} • ${h(o.display_name)}</span></span></div>`).join("")}</div>`
    : `<p class="muted">${t("sealed.noOffers")}</p>`}
  ${p.set_id ? `<p style="margin-top:14px"><a class="btn s" href="${lp(`/set/${encodeURIComponent(p.set_id)}/${slugify(p.set_name || p.set_id)}`)}">${t("sealed.setLink")}</a></p>` : ""}`;
  const jsonLd: any = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, category: `Pokémon TCG ${kind}`, brand: { "@type": "Brand", name: "Pokémon TCG" },
    ...(p.ean ? { gtin13: p.ean } : {}), ...(p.image ? { image: p.image } : {}), ...(p.description ? { description: p.description } : {}),
    ...(offers.length ? { offers: { "@type": "AggregateOffer", priceCurrency: "EUR", offerCount: offers.length,
      lowPrice: Number(p.community_min).toFixed(2), highPrice: Number(p.community_max).toFixed(2) } } : {}),
  };
  cacheHeaders(c);
  return c.html(pageShell({ lang, alternates, title, description, canonical, body, jsonLd: [jsonLd, { "@context": "https://schema.org", ...crumbs([[t("crumb.start"), lp("/")], [t("sealed.crumb"), lp("/sealed")], [p.name, lp(`/sealed/${sealedSlug(p)}`)]]) }],
    image: p.image ? `${SITE()}${cdnImage(p.image, 600, "jpg")}` : undefined }));
}

async function trendsPage(c: any) {
  const lang = langFromPath(c.req.path);
  const t = tr(lang), lp = (p: string) => localPath(lang, p);
  if (!(await rateLimit(`seo:${clientIp(c)}`, 60, 60_000))) return c.text(t("common.tooMany"), 429);
  const movers = (dir: "up" | "down") => db.execute(sql`
    SELECT id, name, image, set_name, local_id, COALESCE(trend, avg)::float AS price,
      ((COALESCE(trend, avg) - avg30) / avg30 * 100)::float AS change
    FROM cards WHERE avg30 >= 3 AND COALESCE(trend, avg) >= 3 AND price_updated_at > now() - interval '10 days'
    ORDER BY change ${dir === "up" ? sql`DESC` : sql`ASC`} LIMIT 24
  `);
  const [up, down, wanted] = await Promise.all([
    movers("up").then(rows).then((l) => localizeCards(lang, l)), movers("down").then(rows).then((l) => localizeCards(lang, l)),
    db.execute(sql`
      SELECT c.id, c.name, c.image, c.set_name, c.local_id, COALESCE(c.trend, c.avg, c.low)::float AS price, count(w.id)::int AS wishers
      FROM wishlist_items w JOIN cards c ON c.id = w.card_id GROUP BY c.id ORDER BY wishers DESC LIMIT 12
    `).then(rows).then((l) => localizeCards(lang, l)),
  ]);
  const ch = (x: any) => `<span class="${x.change >= 0 ? "up" : "down"}">${fmtPct(lang, Number(x.change), 1, true)}</span>`;
  const tt = (x: any) => tile(x, lang).replace("</b></a>", `</b>${x.change !== undefined ? ch(x) : x.wishers ? `<span class="muted">${t("trends.wishers", { n: x.wishers })}</span>` : ""}</a>`);
  const month = fmtDate(lang, Date.now(), { month: "long", year: "numeric" });
  const alternates = alternatesFor("/trends");
  const canonical = canon(lang, alternates);
  const body = `${CSS}<p class="crumb"><a href="${h(lp("/"))}">${t("crumb.start")}</a> › ${t("trends.crumb")}</p><div class="card"><h1>${t("trends.h1", { month: h(month) })}</h1>
    <p class="muted">${t("trends.intro")}</p>
    <div class="btns"><a class="btn y" href="${h(lp("/?tab=portfolio"))}">${t("trends.portfolio")}</a><a class="btn s" href="${lp("/sets")}">${t("set.allSets")}</a></div></div>
    ${up.length ? `<h2>${t("trends.up")}</h2><div class="cards">${up.map(tt).join("")}</div>` : `<p class="muted">${t("trends.building")}</p>`}
    ${down.length ? `<h2>${t("trends.down")}</h2><div class="cards">${down.map(tt).join("")}</div>` : ""}
    ${wanted.length ? `<h2>${t("trends.wanted")}</h2><div class="cards">${wanted.map(tt).join("")}</div>` : ""}`;
  cacheHeaders(c);
  return c.html(pageShell({
    lang, alternates,
    title: t("trends.title", { month }),
    description: t("trends.desc", { lead: up[0] ? t("trends.descLead", { name: up[0].name, change: fmtPct(lang, Number(up[0].change), 0) }) : "" }),
    canonical, body,
    jsonLd: { "@context": "https://schema.org", "@type": "ItemList", name: t("trends.ldName", { month }), url: canonical,
      itemListElement: up.slice(0, 10).map((x: any, i: number) => ({ "@type": "ListItem", position: i + 1, url: `${SITE()}${cardLink(x, lang)}`, name: x.name })) },
  }));
}

// ---------------------------------------------------------------------------
// Sitemaps & Routen (vor registerCatalog registrieren, damit /sitemaps/pokemon.xml nicht im Karten-Muster landet)
// ---------------------------------------------------------------------------
const xml = (c: any, body: string) => {
  publicCache(c, "sitemap");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, 200, { "Content-Type": "application/xml; charset=utf-8" });
};
const loc = (path: string, lastmod?: unknown, extra = "<changefreq>daily</changefreq>") =>
  `<url><loc>${h(`${SITE()}${path}`)}</loc>${lastmod ? `<lastmod>${new Date(String(lastmod)).toISOString().slice(0, 10)}</lastmod>` : ""}${extra}</url>`;

export const SEO_SITEMAPS = ["/sitemaps/pokemon.xml", "/sitemaps/sealed.xml", "/sitemaps/profiles.xml", "/sitemaps/en-pokemon.xml", "/sitemaps/en-sealed.xml"];
export const SEO_STATIC_PAGES = ["/pokemon", "/sealed", "/trends"];

export function registerSeo(app: any) {
  app.get("/pokemon", pokemonIndex);
  app.get("/pokemon/:slug", pokemonPage);
  app.get("/sealed", sealedIndex);
  app.get("/sealed/:slug", sealedPage);
  app.get("/trends", trendsPage);
  // Englische Fassungen (gleiche Renderer, Sprache aus dem Pfad; gleiche Rate-Limits)
  app.get("/en/pokemon", pokemonIndex);
  app.get("/en/pokemon/:slug", pokemonPage);
  app.get("/en/sealed", sealedIndex);
  app.get("/en/sealed/:slug", sealedPage);
  app.get("/en/trends", trendsPage);

  app.get("/sitemaps/pokemon.xml", async (c: any) => {
    const list = await db.select({ slug: pokemonSpecies.slug, updatedAt: pokemonSpecies.updatedAt }).from(pokemonSpecies).orderBy(asc(pokemonSpecies.dexId)).limit(5000);
    return xml(c, list.map((s) => loc(`/pokemon/${s.slug}`, s.updatedAt, "<changefreq>daily</changefreq><priority>0.7</priority>")).join(""));
  });
  app.get("/sitemaps/en-pokemon.xml", async (c: any) => {
    const list = await db.select({ slug: pokemonSpecies.slug, nameEn: pokemonSpecies.nameEn, updatedAt: pokemonSpecies.updatedAt }).from(pokemonSpecies).orderBy(asc(pokemonSpecies.dexId)).limit(5000);
    return xml(c, list.map((s) => loc(`/en/pokemon/${pokemonEnSlug(s.nameEn, s.slug)}`, s.updatedAt, "<changefreq>daily</changefreq><priority>0.6</priority>")).join(""));
  });
  app.get("/sitemaps/en-sealed.xml", async (c: any) => {
    const list = rows(await db.execute(sql`SELECT id, slug, name, COALESCE(ref_updated_at, created_at) AS updated FROM sealed_products WHERE active ORDER BY id LIMIT 5000`));
    return xml(c, list.map((p: any) => loc(`/en/sealed/${sealedSlug(p)}`, p.updated, "<changefreq>daily</changefreq><priority>0.5</priority>")).join(""));
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
    if (!sp) return c.json({ error: "Nicht gefunden" }, 404);
    publicCache(c, "data", { sMaxAge: 3600, swr: 86_400 });
    return c.json({ species: sp });
  });
}
