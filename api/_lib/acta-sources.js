// Source gathering for Acta Diurna: Wikipedia article text and media lists,
// primary-source passages checked word for word against the page they came
// from, and Wikimedia Commons image details with credits. NOT an endpoint.
//
// Everything here runs when a lesson is built, never when a visitor reads
// one, so a lesson costs Wikimedia a handful of requests in its lifetime.
// Wikimedia's API policy asks for a descriptive User-Agent; every request
// sends one. `fetchImpl` is injectable so the tests never touch the network.
const { normalizeFile, containsVerbatim } = require("./acta-lesson");

const USER_AGENT = "acta-diurna/1.0 (https://charliehaldane.ca/acta)";
const WIKI_API = "https://en.wikipedia.org/w/api.php";
const WIKI_REST = "https://en.wikipedia.org/api/rest_v1";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const THUMB_WIDTH = 960; // one of Commons' standard thumbnail steps

/** Sites whose translations are public domain or openly licensed, and stable enough to quote from. */
const PRIMARY_DOMAINS = [
  "perseus.tufts.edu",
  "penelope.uchicago.edu",
  "en.wikisource.org",
  "gutenberg.org",
  "sourcebooks.fordham.edu",
  "avalon.law.yale.edu",
  "classics.mit.edu",
  "sacred-texts.com",
  "topostext.org",
];

const MAX_ARTICLE_CHARS = 60000;
const MAX_ARTICLES = 3;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

// Flags, coats of arms, logos and the like: never a lesson picture.
const JUNK_FILE = /(flag|coat[ _]of[ _]arms|logo|icon|symbol|emblem|signature|wikisource|commons-|wiktionary|question[ _]book|ambox|edit-clear|padlock|disambig|stub|portal|location[ _]dot|red[ _]pog)/i;

function hostAllowed(url, domains = PRIMARY_DOMAINS) {
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.hostname.toLowerCase();
  } catch (_) {
    return false;
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

async function fetchWithTimeout(fetchImpl, url, { timeoutMs = 20000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT, ...headers },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(fetchImpl, url) {
  const res = await fetchWithTimeout(fetchImpl, url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  return res.json();
}

const qs = (params) => new URLSearchParams({ format: "json", formatversion: "2", ...params }).toString();

/**
 * Resolve titles to real articles (following redirects). Missing titles are
 * reported rather than thrown, so a planner's typo is a fixable warning.
 * @returns {Promise<{ found: {asked: string, title: string}[], missing: string[] }>}
 */
async function checkTitles(titles, fetchImpl = fetch) {
  const asked = [...new Set(titles.map((t) => String(t || "").trim()).filter(Boolean))].slice(0, 50);
  if (!asked.length) return { found: [], missing: [] };
  const data = await getJson(fetchImpl, `${WIKI_API}?${qs({ action: "query", redirects: "1", titles: asked.join("|") })}`);
  const q = data.query || {};
  const map = new Map(asked.map((t) => [t, t]));
  for (const n of q.normalized || []) for (const [k, v] of map) if (v === n.from) map.set(k, n.to);
  for (const r of q.redirects || []) for (const [k, v] of map) if (v === r.from) map.set(k, r.to);
  const pages = new Map((q.pages || []).map((p) => [p.title, p]));
  const found = [];
  const missing = [];
  for (const [askedTitle, resolved] of map) {
    const page = pages.get(resolved);
    if (page && !page.missing && !page.invalid) found.push({ asked: askedTitle, title: page.title });
    else missing.push(askedTitle);
  }
  return { found, missing };
}

/** One article's plain text. */
async function articleText(title, fetchImpl) {
  const data = await getJson(
    fetchImpl,
    `${WIKI_API}?${qs({ action: "query", redirects: "1", prop: "extracts|info", explaintext: "1", inprop: "url", titles: title })}`
  );
  const page = ((data.query || {}).pages || [])[0];
  if (!page || page.missing || !page.extract) throw new Error(`No Wikipedia article called "${title}".`);
  // Drop the reference-only tail sections; they are noise for the writer.
  const text = page.extract
    .split(/\n==+ ?(See also|References|Notes|Citations|Sources|Further reading|External links|Bibliography|Footnotes) ?==+\n/)[0]
    .slice(0, MAX_ARTICLE_CHARS);
  return { title: page.title, url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`, text };
}

/** The images used in an article, with their captions. Falls back to the action API. */
async function articleMedia(title, fetchImpl) {
  try {
    const data = await getJson(fetchImpl, `${WIKI_REST}/page/media-list/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    return (data.items || [])
      .filter((i) => i && i.type === "image" && i.title)
      .map((i) => ({
        file: normalizeFile(i.title),
        caption: (i.caption && i.caption.text ? i.caption.text : "").replace(/\s+/g, " ").trim().slice(0, 300),
      }));
  } catch (_) {
    const data = await getJson(fetchImpl, `${WIKI_API}?${qs({ action: "query", redirects: "1", prop: "images", imlimit: "100", titles: title })}`);
    const page = ((data.query || {}).pages || [])[0] || {};
    return (page.images || []).map((i) => ({ file: normalizeFile(i.title), caption: "" }));
  }
}

/**
 * Everything the writer may use for one topic: up to three articles and the
 * union of their media lists (junk files filtered out).
 */
async function gather(wikiTitles, fetchImpl = fetch) {
  const titles = [...new Set((wikiTitles || []).filter(Boolean))].slice(0, MAX_ARTICLES);
  if (!titles.length) throw new Error("The topic has no Wikipedia articles to work from.");
  const articles = [];
  const media = [];
  const seen = new Set();
  for (const t of titles) {
    try {
      const a = await articleText(t, fetchImpl);
      articles.push(a);
      for (const m of await articleMedia(a.title, fetchImpl).catch(() => [])) {
        if (!m.file || seen.has(m.file) || JUNK_FILE.test(m.file)) continue;
        seen.add(m.file);
        media.push(m);
      }
    } catch (e) {
      if (!articles.length && t === titles[titles.length - 1]) throw e;
    }
  }
  if (!articles.length) throw new Error(`None of the articles could be read: ${titles.join(", ")}.`);
  return { articles, media: media.slice(0, 80), passages: [], fetchedAt: new Date().toISOString() };
}

/** HTML to readable plain text, good enough to search for a quotation in. */
function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(mdash|ndash|lsquo|rsquo|ldquo|rdquo|hellip|amp|lt|gt|quot|apos);/g, (_, e) =>
      ({ mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[e]
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

async function readPage(url, fetchImpl) {
  const res = await fetchWithTimeout(fetchImpl, url, { timeoutMs: 20000 });
  if (!res.ok) throw new Error(`${res.status}`);
  const len = Number(res.headers && res.headers.get ? res.headers.get("content-length") : 0);
  if (len && len > MAX_PAGE_BYTES) throw new Error("too large");
  const body = await res.text();
  return htmlToText(body.slice(0, MAX_PAGE_BYTES));
}

/**
 * Keep only the passages that really are on the page they cite. The research
 * model proposes them; this fetches each page itself and searches for the
 * excerpt word for word, so a misremembered translation never reaches a card.
 */
async function verifyPassages(candidates, fetchImpl = fetch, { max = 5 } = {}) {
  const out = [];
  const pageCache = new Map();
  for (const c of candidates || []) {
    if (out.length >= max) break;
    if (!c || typeof c.excerpt !== "string" || typeof c.url !== "string") continue;
    const excerpt = c.excerpt.replace(/\s+/g, " ").trim();
    if (excerpt.split(" ").length < 8 || !hostAllowed(c.url)) continue;
    try {
      if (!pageCache.has(c.url)) pageCache.set(c.url, await readPage(c.url, fetchImpl));
      if (!containsVerbatim(pageCache.get(c.url), excerpt)) continue;
      out.push({
        id: `p${out.length + 1}`,
        citation: String(c.citation || "").trim().slice(0, 200),
        translator: c.translator ? String(c.translator).trim().slice(0, 120) : null,
        url: c.url,
        excerpt: excerpt.slice(0, 3000),
      });
    } catch (_) {
      /* unreachable page: the passage just isn't used */
    }
  }
  return out;
}

const stripHtml = (s) => htmlToText(s).replace(/\s+/g, " ").trim();

/** Commons now appends utm_* tracking parameters to file URLs; drop them. */
function cleanUrl(url) {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
    return u.toString();
  } catch (_) {
    return url;
  }
}

/**
 * A readable name from Commons' Artist field (HTML). It hides a duplicate
 * label in display:none spans, prefixes derivative works with the source
 * file ("Map_x.svg: Marsyas"), and trails notes ("This panoramic image was
 * created…"); keep just the name. "Anonymous"/"Unknown author" become "Unknown".
 */
function cleanArtist(html) {
  let s = String(html || "").replace(/<(span|div)[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = htmlToText(s).replace(/\s+/g, " ").trim();
  s = s.replace(/^\S+\.(svg|png|jpe?g|gif|tiff?)\s*:\s*/i, "");
  s = s.split(/\s(?=This\s)|(?<![A-Z])\.\s|\s\(talk\)|\s?derivative work:/i)[0].trim();
  if (/^(anonymous|unknown)\b/i.test(s)) return "Unknown";
  return s.slice(0, 80);
}

/**
 * Who to credit. For a photo of an ancient object the Artist is the maker
 * ("Unknown"); a CC licence needs the photographer, who is in Credit
 * ("Self-photographed by Marsyas, December 2005").
 */
function creditedName(meta, license) {
  const artist = cleanArtist(meta.Artist && meta.Artist.value) || "Unknown";
  if (artist !== "Unknown" || /public domain|cc0|pd/i.test(license || "")) return artist;
  const credit = cleanArtist(meta.Credit && meta.Credit.value)
    .replace(/^(self-photographed|photographed|photo|own work)(\s+by)?\s*/i, "")
    .replace(/\s*\(\d{1,2}\.\d{1,2}\.\d{4}\)\s*$/, "")
    .replace(/,\s*(january|february|march|april|may|june|july|august|september|october|november|december)?\s*\d{4}\s*$/i, "")
    .trim();
  return credit ? `Photo: ${credit}` : artist;
}

/**
 * Commons details for a set of files: a sized URL plus artist and licence.
 * Files that aren't on Commons (en.wikipedia's local, often non-free files)
 * are left out, so only freely licensed images ever reach a card.
 * @returns {Promise<Map<string, object>>} keyed by normalized file title
 */
async function resolveImages(files, fetchImpl = fetch) {
  const wanted = [...new Set((files || []).map(normalizeFile).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < wanted.length; i += 40) {
    const chunk = wanted.slice(i, i + 40);
    const data = await getJson(
      fetchImpl,
      `${COMMONS_API}?${qs({
        action: "query",
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        iiurlwidth: String(THUMB_WIDTH),
        iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Credit",
        titles: chunk.join("|"),
      })}`
    );
    const q = data.query || {};
    const back = new Map(chunk.map((f) => [f, f]));
    for (const n of q.normalized || []) for (const [k, v] of back) if (v === n.from) back.set(k, n.to);
    const pages = new Map((q.pages || []).map((p) => [normalizeFile(p.title), p]));
    for (const [asked, resolved] of back) {
      const page = pages.get(normalizeFile(resolved));
      const info = page && !page.missing && page.imageinfo && page.imageinfo[0];
      if (!info || !(info.thumburl || info.url)) continue;
      const meta = info.extmetadata || {};
      const val = (k) => (meta[k] && meta[k].value ? stripHtml(String(meta[k].value)) : "");
      out.set(asked, {
        url: cleanUrl(info.thumburl || info.url),
        width: info.width || info.thumbwidth || null,
        height: info.height || info.thumbheight || null,
        descUrl: cleanUrl(info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(asked.replace(/ /g, "_"))}`),
        artist: creditedName(meta, val("LicenseShortName")),
        license: val("LicenseShortName").slice(0, 60) || "See file page",
        ...(val("LicenseUrl") ? { licenseUrl: val("LicenseUrl") } : {}),
      });
    }
  }
  return out;
}

/** Attach resolved image details to a lesson's cards; drop images Commons doesn't have. */
function applyImages(lesson, resolved) {
  const cards = lesson.cards.map((c) => {
    if (!c.image) return c;
    const r = resolved.get(normalizeFile(c.image.file));
    if (!r) {
      const { image, ...rest } = c;
      return rest;
    }
    return { ...c, image: { ...c.image, ...r } };
  });
  return { ...lesson, cards };
}

const MENTION_CHARS = 600;

/** Wikipedia's lead, cut at a sentence end so a popup stays short. */
function trimLead(text, max = MENTION_CHARS) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

/** "File:X.jpg" for a Commons upload URL (original or thumbnail); null for en.wikipedia's local, often non-free, files. */
function commonsFileOf(url) {
  const m = /\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(String(url || ""));
  if (!m) return null;
  try {
    return normalizeFile(decodeURIComponent(m[1]));
  } catch (_) {
    return null;
  }
}

/**
 * Wikipedia's own summary of each person and place a lesson names, fetched
 * once when the lesson goes live so readers never wait on the API. A mention
 * is dropped when its article is missing or a disambiguation page, or when it
 * is the lesson's own subject (`exclude`); two that land on the same article
 * are merged. Pictures keep only Commons files, with their credits.
 */
async function resolveMentions(mentions, { exclude = [] } = {}, fetchImpl = fetch) {
  const own = new Set(exclude.map((t) => String(t).replace(/_/g, " ").toLowerCase()));
  const byTitle = new Map();
  for (const m of mentions || []) {
    if (!m || !m.wiki || !Array.isArray(m.names) || !m.names.length) continue;
    let d;
    try {
      d = await getJson(fetchImpl, `${WIKI_REST}/page/summary/${encodeURIComponent(m.wiki.replace(/ /g, "_"))}`);
    } catch (_) {
      continue; // no such article, or Wikipedia didn't answer: the name just isn't linked
    }
    const title = String((d.titles && d.titles.normalized) || d.title || "");
    if (d.type !== "standard" || !d.extract || !title || own.has(title.toLowerCase())) continue;
    const had = byTitle.get(title);
    if (had) {
      had.names = [...new Set([...had.names, ...m.names])];
      continue;
    }
    const thumb = d.thumbnail || {};
    byTitle.set(title, {
      wiki: m.wiki,
      kind: m.kind,
      names: m.names,
      title,
      ...(d.description ? { description: String(d.description).slice(0, 160) } : {}),
      extract: trimLead(d.extract),
      url: cleanUrl((d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`),
      _file: thumb.source ? commonsFileOf((d.originalimage || thumb).source) : null,
      _thumb: thumb,
    });
  }
  const out = [...byTitle.values()];
  const files = out.map((m) => m._file).filter(Boolean);
  let credits = new Map();
  if (files.length) {
    try {
      credits = await resolveImages(files, fetchImpl);
    } catch (_) {
      /* no credits, no pictures; the summaries still stand */
    }
  }
  return out.map(({ _file, _thumb, ...m }) => {
    const c = _file && credits.get(_file);
    if (!c) return m;
    const { url, width, height, ...credit } = c;
    return { ...m, image: { url: cleanUrl(_thumb.source), width: _thumb.width || null, height: _thumb.height || null, ...credit } };
  });
}

/** One string of everything a quote may be checked against. */
function corpusOf(sources) {
  if (!sources) return "";
  const parts = [];
  for (const a of sources.articles || []) parts.push(a.text);
  for (const p of sources.passages || []) parts.push(p.excerpt);
  return parts.join("\n\n");
}

module.exports = {
  USER_AGENT,
  PRIMARY_DOMAINS,
  hostAllowed,
  cleanUrl,
  cleanArtist,
  creditedName,
  checkTitles,
  gather,
  htmlToText,
  verifyPassages,
  resolveImages,
  applyImages,
  commonsFileOf,
  resolveMentions,
  corpusOf,
};
