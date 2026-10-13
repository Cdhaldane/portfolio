const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("./acta-sources");

/** A fetch that answers from a URL → response table; records what was asked. */
function fakeFetch(routes) {
  const asked = [];
  const fn = async (url, opts) => {
    asked.push({ url, opts });
    for (const [match, body] of routes) {
      if (url.includes(match)) {
        const val = typeof body === "function" ? body(url) : body;
        if (val instanceof Error) throw val;
        const status = val && val.__status ? val.__status : 200;
        const text = typeof val === "string" ? val : JSON.stringify(val);
        return { ok: status < 400, status, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text };
      }
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), text: async () => "" };
  };
  fn.asked = asked;
  return fn;
}

test("every Wikimedia request carries the descriptive User-Agent", async () => {
  const f = fakeFetch([["w/api.php", { query: { pages: [{ title: "X", extract: "Text", fullurl: "https://en.wikipedia.org/wiki/X" }] } }]]);
  await S.gather(["X"], f);
  for (const a of f.asked) assert.equal(a.opts.headers["User-Agent"], S.USER_AGENT);
});

test("hostAllowed only admits the primary-source sites", () => {
  assert.equal(S.hostAllowed("https://www.perseus.tufts.edu/hopper/text?doc=Hdt.+8.90"), true);
  assert.equal(S.hostAllowed("https://penelope.uchicago.edu/Thayer/E/Roman/Texts/x.html"), true);
  assert.equal(S.hostAllowed("https://evilperseus.tufts.edu.example.com/"), false);
  assert.equal(S.hostAllowed("https://example.com/perseus.tufts.edu"), false);
  // eslint-disable-next-line no-script-url
  assert.equal(S.hostAllowed("javascript:alert(1)"), false);
});

test("checkTitles follows normalisation and redirects and reports missing ones", async () => {
  const f = fakeFetch([
    [
      "w/api.php",
      {
        query: {
          normalized: [{ from: "battle of salamis", to: "Battle of salamis" }],
          redirects: [{ from: "Battle of salamis", to: "Battle of Salamis" }],
          pages: [{ title: "Battle of Salamis", pageid: 1 }, { title: "Nope", missing: true }],
        },
      },
    ],
  ]);
  const r = await S.checkTitles(["battle of salamis", "Nope"], f);
  assert.deepEqual(r.found, [{ asked: "battle of salamis", title: "Battle of Salamis" }]);
  assert.deepEqual(r.missing, ["Nope"]);
});

test("gather strips reference sections and junk files", async () => {
  const f = fakeFetch([
    ["media-list", { items: [{ type: "image", title: "File:Battle.jpg", caption: { text: "A battle" } }, { type: "image", title: "File:Flag of Greece.svg" }, { type: "video", title: "File:Clip.webm" }] }],
    ["w/api.php", { query: { pages: [{ title: "Battle of Salamis", fullurl: "https://en.wikipedia.org/wiki/Battle_of_Salamis", extract: "Intro.\n\n== Battle ==\nThe fight.\n\n== References ==\nRef list" }] } }],
  ]);
  const g = await S.gather(["Battle of Salamis"], f);
  assert.equal(g.articles[0].text.includes("Ref list"), false);
  assert.equal(g.articles[0].text.includes("The fight."), true);
  assert.deepEqual(g.media, [{ file: "File:Battle.jpg", caption: "A battle" }]);
  assert.deepEqual(g.passages, []);
});

test("gather fails clearly when no article can be read", async () => {
  const f = fakeFetch([["w/api.php", { query: { pages: [{ title: "X", missing: true }] } }]]);
  await assert.rejects(S.gather(["X"], f), /No Wikipedia article/);
  await assert.rejects(S.gather([], f), /no Wikipedia articles/);
});

test("verifyPassages keeps only excerpts found word for word on an allowed page", async () => {
  const page = "<html><body><p>[4] Whenever Xerxes, as he sat beneath the mountain opposite Salamis which is called <a>Aegaleos</a> , saw one of his own men achieve some feat in the battle, he inquired who did it.</p></body></html>";
  const f = fakeFetch([["perseus.tufts.edu", page]]);
  const good = {
    citation: "Herodotus 8.90",
    translator: "A. D. Godley",
    url: "https://www.perseus.tufts.edu/hopper/text?doc=Hdt.+8.90",
    excerpt: "Whenever Xerxes, as he sat beneath the mountain opposite Salamis which is called Aegaleos, saw one of his own men achieve some feat",
  };
  const altered = { ...good, excerpt: "Whenever Xerxes, sitting beneath the mountain opposite Salamis called Aegaleos, saw one of his own men do some great deed" };
  const offsite = { ...good, url: "https://example.com/hdt" };
  const out = await S.verifyPassages([good, altered, offsite], f);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "p1");
  assert.equal(out[0].translator, "A. D. Godley");
  // The page was fetched once even though two candidates cite it.
  assert.equal(f.asked.filter((a) => a.url.includes("perseus")).length, 1);
});

test("htmlToText decodes entities and drops scripts", () => {
  assert.equal(S.htmlToText("<script>x()</script><p>A &amp; B &mdash; &#8220;C&#8221;</p>"), "A & B — “C”");
});

test("resolveImages keeps Commons files with credits and drops local ones", async () => {
  const f = fakeFetch([
    [
      "commons.wikimedia.org",
      {
        query: {
          normalized: [{ from: "File:Battle_of_Salamis.jpg", to: "File:Battle of Salamis.jpg" }],
          pages: [
            {
              title: "File:Battle of Salamis.jpg",
              imageinfo: [
                {
                  thumburl: "https://thumb.wikimedia.org/x/960px-B.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo",
                  url: "https://upload.wikimedia.org/B.jpg",
                  width: 2000,
                  height: 1000,
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Battle_of_Salamis.jpg",
                  extmetadata: {
                    Artist: { value: '<a href="//x">Gryffindor</a> This panoramic image was created with Autostitch.' },
                    LicenseShortName: { value: "Public domain" },
                  },
                },
              ],
            },
            { title: "File:Local fair use.jpg", missing: true, known: true },
          ],
        },
      },
    ],
  ]);
  const m = await S.resolveImages(["File:Battle of Salamis.jpg", "File:Local fair use.jpg"], f);
  assert.equal(m.size, 1);
  const r = m.get("File:Battle of Salamis.jpg");
  assert.equal(r.url, "https://thumb.wikimedia.org/x/960px-B.jpg");
  assert.equal(r.artist, "Gryffindor");
  assert.equal(r.license, "Public domain");
  assert.equal(r.width, 2000);

  const lesson = { cards: [{ type: "open", image: { file: "File:Battle of Salamis.jpg", alt: "x" } }, { type: "story", image: { file: "File:Local fair use.jpg", alt: "y" } }] };
  const applied = S.applyImages(lesson, m);
  assert.equal(applied.cards[0].image.url, r.url);
  assert.equal(applied.cards[1].image, undefined);
});

test("cleanArtist keeps just the name", () => {
  assert.equal(S.cleanArtist('<div class="fn value">\nUnknown artist<span style="display: none;">Unknown artist</span></div>'), "Unknown");
  assert.equal(S.cleanArtist('<span lang="en">Anonymous</span><span style="display:none">Unknown author</span>'), "Unknown");
  assert.equal(S.cleanArtist('<bdi><a href="x"><span title="British artist">Alfred C. Weatherstone</span></a></bdi>'), "Alfred C. Weatherstone");
  assert.equal(
    S.cleanArtist('<ul><li><a href="x">Map_athenian_empire_431_BC-fr.svg</a>: <a href="y">Marsyas</a></li>\n<li>derivative work: <a href="z">Someone</a></li></ul>'),
    "Marsyas"
  );
  assert.equal(S.cleanArtist("Wilhelm von Kaulbach"), "Wilhelm von Kaulbach");
  assert.equal(S.cleanArtist(""), "");
});

test("a CC photo of an anonymous object credits the photographer", () => {
  const hidden = '<div class="fn value">Unknown artist<span style="display: none;">Unknown artist</span></div>';
  const meta = (credit) => ({ Artist: { value: hidden }, Credit: { value: credit } });
  assert.equal(S.creditedName(meta('<span class="int-own-work">Self-photographed</span> by <a href="u">Marsyas</a>, December 2005'), "CC BY-SA 2.5"), "Photo: Marsyas");
  assert.equal(S.creditedName(meta('<a href="u">Μαρσύας</a> (29.05.2007)'), "CC BY-SA 3.0"), "Photo: Μαρσύας");
  // Public domain needs no credit chase.
  assert.equal(S.creditedName(meta("Self-photographed by Marsyas"), "Public domain"), "Unknown");
});

test("commonsFileOf reads Commons originals and thumbnails, not local files", () => {
  assert.equal(S.commonsFileOf("https://upload.wikimedia.org/wikipedia/commons/8/86/Illustrerad_Verldshistoria_band_I_Ill_116.png?utm_source=x"), "File:Illustrerad Verldshistoria band I Ill 116.png");
  assert.equal(S.commonsFileOf("https://thumb.wikimedia.org/wikipedia/commons/thumb/3/34/Boston_%282019%29_-_194.jpg/330px-Boston_%282019%29_-_194.jpg"), "File:Boston (2019) - 194.jpg");
  assert.equal(S.commonsFileOf("https://upload.wikimedia.org/wikipedia/en/1/1a/Poster.jpg"), null);
  assert.equal(S.commonsFileOf(undefined), null);
});

test("resolveMentions keeps real articles with Commons pictures and drops the rest", async () => {
  const summary = (title, extra = {}) => ({
    type: "standard",
    title,
    titles: { normalized: title },
    description: `About ${title}`,
    extract: `${title} was here.`,
    content_urls: { desktop: { page: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}` } },
    ...extra,
  });
  const f = fakeFetch([
    [
      "summary/Themistocles",
      summary("Themistocles", {
        thumbnail: { source: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/T.png/330px-T.png?utm_source=en.wikipedia.org", width: 330, height: 576 },
        originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/8/86/T.png" },
      }),
    ],
    [
      "summary/Some_film",
      summary("Some film", { thumbnail: { source: "https://upload.wikimedia.org/wikipedia/en/1/1a/Poster.jpg", width: 200, height: 300 } }),
    ],
    ["summary/Laurion", summary("Lavrio")],
    ["summary/Lavrio", summary("Lavrio")],
    ["summary/Xerxes", { type: "disambiguation", title: "Xerxes", extract: "Xerxes may refer to:" }],
    ["summary/Battle_of_Salamis", summary("Battle of Salamis")],
    ["summary/Nowhere", { __status: 404 }],
    [
      "commons.wikimedia.org",
      { query: { pages: [{ title: "File:T.png", imageinfo: [{ url: "https://upload.wikimedia.org/T.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:T.png", extmetadata: { Artist: { value: "Evald Hansen" }, LicenseShortName: { value: "Public domain" } } }] }] } },
    ],
  ]);
  const out = await S.resolveMentions(
    [
      { wiki: "Themistocles", kind: "person", names: ["Themistocles"] },
      { wiki: "Some film", kind: "place", names: ["the film"] },
      { wiki: "Laurion", kind: "place", names: ["Laurion"] },
      { wiki: "Lavrio", kind: "place", names: ["Lavrion"] },
      { wiki: "Xerxes", kind: "person", names: ["Xerxes"] },
      { wiki: "Battle of Salamis", kind: "place", names: ["Salamis"] },
      { wiki: "Nowhere", kind: "place", names: ["Nowhere"] },
    ],
    { exclude: ["Battle_of_Salamis"] },
    f
  );
  assert.deepEqual(
    out.map((m) => m.title),
    ["Themistocles", "Some film", "Lavrio"]
  );
  const [them, film, lavrio] = out;
  assert.equal(them.description, "About Themistocles");
  assert.equal(them.url, "https://en.wikipedia.org/wiki/Themistocles");
  assert.deepEqual(them.image, {
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/86/T.png/330px-T.png",
    width: 330,
    height: 576,
    descUrl: "https://commons.wikimedia.org/wiki/File:T.png",
    artist: "Evald Hansen",
    license: "Public domain",
  });
  // A local (often non-free) lead image is left off.
  assert.equal(film.image, undefined);
  // Two names that land on the same article become one mention.
  assert.deepEqual(lavrio.names, ["Laurion", "Lavrion"]);
  for (const a of f.asked) assert.equal(a.opts.headers["User-Agent"], S.USER_AGENT);
});

test("resolveMentions keeps popups short", async () => {
  const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says something.`).join(" ");
  const f = fakeFetch([["summary/X", { type: "standard", title: "X", extract: long }]]);
  const [m] = await S.resolveMentions([{ wiki: "X", kind: "place", names: ["X"] }], {}, f);
  assert.ok(m.extract.length <= 600 && m.extract.endsWith("."), m.extract);
});

test("corpusOf joins articles and passages", () => {
  assert.equal(S.corpusOf({ articles: [{ text: "A" }], passages: [{ excerpt: "B" }] }), "A\n\nB");
  assert.equal(S.corpusOf(null), "");
});
