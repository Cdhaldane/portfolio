/*
 * TOP DECK: "My Top 5 Things", printed as a collectible card set.
 *
 * Charlie's real picks: Movies, Games, TV #1-3 and Albums #1. Everything
 * else is still a placeholder, marked inline. Easiest swap: STAFF ONLY in the
 * page footer (the back office); saved edits override what's shipped here.
 *
 *  - One pack per category. `cards` is ordered #1 -> #5. Rarity (#1 Legendary
 *    ... #5 Common), collector numbers and the fan order are all DERIVED, so
 *    reordering the array is all it takes to re-rank.
 *  - `take` is the one-line hot take printed on the card (keep it short: see
 *    LIMITS; top5.data.test.js fails if a swap would overflow a card).
 *  - `stats` are three 0-10 scores, labelled by the pack's `statLabels`.
 *  - `icon` is a free Font Awesome solid name used as the card art.
 *  - `flourish` is the pack's #1 card party trick: steam | spin | scan | sparkle.
 *  - Add a pack: copy one, give it a unique `id` and a wrapper `hue` (0-360).
 */

export const SET = { code: "TD1", name: "Top Deck", series: "Series 01" };

export const CARDS_PER_PACK = 5;

/** Character budgets the card layout is designed around (the API enforces them too). */
export const LIMITS = {
  packName: 14,
  tagline: 28,
  statLabel: 12,
  title: 34,
  meta: 40,
  take: 90,
  fun: 48,
};

export const RARITY = {
  1: { code: "L", label: "Legendary", symbol: "fa-crown", tier: "legendary" },
  2: { code: "UR", label: "Ultra Rare", symbol: "fa-star", tier: "ultra" },
  3: { code: "R", label: "Rare", symbol: "fa-star", tier: "rare" },
  4: { code: "U", label: "Uncommon", symbol: "fa-diamond", tier: "uncommon" },
  5: { code: "C", label: "Common", symbol: "fa-circle", tier: "common" },
};

export const PACKS = [
  {
    id: "movies",
    name: "Movies",
    tagline: "Feature Presentation",
    kind: "Film",
    icon: "fa-film",
    hue: 8,
    flourish: "sparkle",
    statLabels: ["Rewatch", "Quotes", "Vibes"],
    cards: [
      { id: "dune2", title: "Dune: Part Two", meta: "2024 · Denis Villeneuve", icon: "fa-sun", take: "Sandworm riding should be an Olympic sport. Peak big-screen cinema.", stats: [9, 8, 10], fun: "Times I've said 'Lisan al-Gaib': many" },
      { id: "arrival", title: "Arrival", meta: "2016 · Denis Villeneuve", icon: "fa-language", take: "A first-contact movie that's secretly about grief. Still not over it.", stats: [8, 7, 10], fun: "Heptapod words I can read: 0" },
      { id: "goodwillhunting", title: "Good Will Hunting", meta: "1997 · Gus Van Sant", icon: "fa-square-root-variable", take: "How do you like them apples? It's not your fault.", stats: [9, 10, 9], fun: "Chalkboard proofs understood: 0" },
      { id: "tenet", title: "Tenet", meta: "2020 · Christopher Nolan", icon: "fa-rotate-left", take: "Don't try to understand it. Feel it. (Fourth watch, I understood it.)", stats: [10, 7, 9], fun: "Watches needed to follow it: 4" },
      { id: "wintersoldier", title: "The Winter Soldier", meta: "2014 · Captain America · Russo Bros.", icon: "fa-shield-halved", take: "The best Marvel movie. The elevator fight alone earns the spot.", stats: [10, 8, 9], fun: "Elevator fight rewinds: several" },
    ],
  },
  {
    id: "food",
    name: "Food",
    tagline: "Chef's Selection",
    kind: "Dish",
    icon: "fa-bowl-food",
    hue: 32,
    flourish: "steam",
    statLabels: ["Comfort", "Crave", "Mess"],
    cards: [
      { id: "pizza", title: "Neapolitan Pizza", meta: "Naples, via a very hot oven", icon: "fa-pizza-slice", take: "Leopard-spotted crust, basil, done. The perfect food.", stats: [10, 10, 6], fun: "Slices left behind: 0" },
      { id: "poutine", title: "Poutine", meta: "Québec's gift to humanity", icon: "fa-cheese", take: "Squeaky curds or it doesn't count. That's basically Canadian law.", stats: [10, 9, 9], fun: "Squeak factor: 10/10" },
      { id: "butterchicken", title: "Butter Chicken", meta: "Delhi-born, Toronto-perfected", icon: "fa-bowl-rice", take: "Naan is a utensil. Fight me.", stats: [9, 9, 7], fun: "Naan-to-curry ratio: 2:1" },
      { id: "ramen", title: "Tonkotsu Ramen", meta: "12-hour pork broth", icon: "fa-bowl-food", take: "Slurping is a compliment. I compliment loudly.", stats: [9, 8, 8], fun: "Broth sips before noodles: always" },
      { id: "buttertarts", title: "Butter Tarts", meta: "Ontario's finest", icon: "fa-cookie", take: "Runny, not firm. This is not up for debate.", stats: [8, 9, 7], fun: "Raisins: a controversy" },
    ],
  },
  {
    id: "albums",
    name: "Albums",
    tagline: "Side A · Side B",
    kind: "Record",
    icon: "fa-compact-disc",
    hue: 268,
    flourish: "spin",
    statLabels: ["Replay", "Cohesion", "Mood"],
    cards: [
      { id: "speakforyourself", title: "Speak for Yourself", meta: "Imogen Heap · 2005", icon: "fa-microphone", take: "Hide and Seek alone earns the top spot. Mmm, whatcha say.", stats: [10, 9, 10], fun: "Hide and Seek chills: every time" },
      // #2 to #5: still placeholders (swap them in the back office).
      { id: "discovery", title: "Discovery", meta: "Daft Punk · 2001", icon: "fa-robot", take: "Two robots made the most human album ever.", stats: [10, 9, 10], fun: "'One More Time' plays: one more" },
      { id: "currents", title: "Currents", meta: "Tame Impala · 2015", icon: "fa-circle-half-stroke", take: "The official soundtrack of 2am debugging.", stats: [9, 9, 9], fun: "Bugs fixed to it: hundreds" },
      { id: "inrainbows", title: "In Rainbows", meta: "Radiohead · 2007", icon: "fa-rainbow", take: "Pay-what-you-want, and it was still a steal.", stats: [9, 10, 8], fun: "Times I paid: once, gladly" },
      { id: "fullycompletely", title: "Fully Completely", meta: "The Tragically Hip · 1992", icon: "fa-guitar", take: "Canadian law requires it on every road trip.", stats: [9, 8, 9], fun: "Road trips soundtracked: all of them" },
    ],
  },
  {
    id: "games",
    name: "Games",
    tagline: "Press Start",
    kind: "Game",
    icon: "fa-gamepad",
    hue: 190,
    flourish: "sparkle",
    statLabels: ["Hours", "Replay", "Rage"],
    cards: [
      { id: "mw2", title: "Modern Warfare 2", meta: "2009 · Infinity Ward", icon: "fa-crosshairs", take: "Rust 1v1s, noob tubes, and the best lobbies gaming ever had.", stats: [10, 10, 9], fun: "Tactical nukes called in: a few" },
      { id: "aoe2", title: "Age of Empires II", meta: "1999 · Ensemble Studios", icon: "fa-chess-rook", take: "Wololo. Still playing it 25 years later. Still losing to the AI.", stats: [10, 10, 7], fun: "Villagers lost to boars: countless" },
      { id: "rct1", title: "RollerCoaster Tycoon", meta: "1999 · Chris Sawyer", icon: "fa-ticket", take: "Built a beautiful park. Then removed the exit from the coaster.", stats: [9, 9, 3], fun: "Guests who wanted to go home: all" },
      { id: "poe2", title: "Path of Exile 2", meta: "2024 · Grinding Gear Games", icon: "fa-skull", take: "One more map. The passive tree is a lifestyle, not a menu.", stats: [10, 9, 8], fun: "Respecs this league: too many" },
      { id: "league", title: "League of Legends", meta: "2009 · Riot Games", icon: "fa-hat-wizard", take: "Not a game, a relationship. A complicated one.", stats: [10, 10, 10], fun: "Times I said 'last game': every night" },
    ],
  },
  {
    id: "tv",
    name: "TV Shows",
    tagline: "Previously On…",
    kind: "Series",
    icon: "fa-tv",
    hue: 320,
    flourish: "scan",
    statLabels: ["Binge", "Rewatch", "Cliffhanger"],
    cards: [
      { id: "andor", title: "Andor", meta: "2022 · Disney+", icon: "fa-handcuffs", take: "Star Wars for grown-ups. The Narkina 5 arc is TV at its best.", stats: [10, 9, 9], fun: "'One way out' rewatches: plenty" },
      { id: "got", title: "Game of Thrones", meta: "2011 · HBO", icon: "fa-dragon", take: "Seasons 1 to 4 are untouchable. We don't talk about the ending.", stats: [10, 7, 10], fun: "Red Wedding recovery time: years" },
      { id: "invincible", title: "Invincible", meta: "2021 · Prime Video", icon: "fa-mask", take: "Looks like a kids' cartoon. Absolutely is not. THINK, MARK!", stats: [9, 8, 10], fun: "'Think, Mark!' quotes per week: 3" },
      // #4 and #5: still placeholders (swap them in the back office).
      { id: "breakingbad", title: "Breaking Bad", meta: "2008 · AMC", icon: "fa-flask", take: "Five perfect seasons. Do not take career advice from it.", stats: [10, 8, 10], fun: "Pizzas on roofs: 1" },
      { id: "arcane", title: "Arcane", meta: "2021 · Fortiche", icon: "fa-palette", take: "The animation should honestly be illegal.", stats: [10, 9, 9], fun: "Frames I paused on: most" },
    ],
  },
  {
    id: "places",
    name: "Places",
    tagline: "Wish You Were Here",
    kind: "Destination",
    icon: "fa-earth-americas",
    hue: 140,
    flourish: "sparkle",
    statLabels: ["Views", "Food", "Return"],
    cards: [
      { id: "algonquin", title: "Algonquin Park", meta: "Ontario", icon: "fa-tree", take: "Canoe, campfire, zero bars of signal. Perfect.", stats: [10, 6, 10], fun: "Loon calls heard: dozens" },
      { id: "tokyo", title: "Tokyo", meta: "Japan", icon: "fa-torii-gate", take: "A convenience-store egg sandwich changed my life.", stats: [9, 10, 10], fun: "Vending machines per block: 4" },
      { id: "montreal", title: "Montréal", meta: "Québec", icon: "fa-city", take: "Bagels at 2am and smoked meat the size of my head.", stats: [8, 10, 9], fun: "Bagels per trip: 12" },
      { id: "liftlock", title: "Peterborough Lift Lock", meta: "Ontario", icon: "fa-ship", take: "A boat elevator from 1904 that still works. Engineering.", stats: [7, 5, 8], fun: "Times I've explained it: many" },
      { id: "banff", title: "Banff", meta: "Alberta", icon: "fa-mountain-sun", take: "Lakes so blue they look photoshopped.", stats: [10, 7, 9], fun: "Photos taken: 800" },
    ],
  },
  {
    id: "snacks",
    name: "Snacks",
    tagline: "After-Hours Munchies",
    kind: "Snack",
    icon: "fa-cookie-bite",
    hue: 52,
    flourish: "sparkle",
    statLabels: ["Crunch", "Crave", "Share"],
    cards: [
      { id: "alldressed", title: "All Dressed Chips", meta: "Every flavour at once", icon: "fa-wand-magic-sparkles", take: "Every flavour at once. Peak snack engineering.", stats: [10, 10, 1], fun: "Bags 'shared': 0" },
      { id: "ketchupchips", title: "Ketchup Chips", meta: "A Canadian birthright", icon: "fa-bottle-droplet", take: "The rest of the world doesn't know what it's missing.", stats: [9, 9, 3], fun: "Red fingertips: guaranteed" },
      { id: "coffeecrisp", title: "Coffee Crisp", meta: "Desk-drawer essential", icon: "fa-mug-saucer", take: "Canada's greatest export after maple syrup.", stats: [8, 9, 5], fun: "Desk-drawer stash: always" },
      { id: "nanaimo", title: "Nanaimo Bar", meta: "British Columbia", icon: "fa-layer-group", take: "Three layers of pure BC engineering.", stats: [6, 9, 6], fun: "Layers: 3 (perfect)" },
      { id: "swedishberries", title: "Swedish Berries", meta: "Neither Swedish nor berries", icon: "fa-question", take: "Not Swedish. Not berries. No notes.", stats: [5, 8, 8], fun: "Bags finished alone: most" },
    ],
  },
  {
    id: "party",
    name: "Party Games",
    tagline: "Game Night",
    kind: "Party Game",
    icon: "fa-dice",
    hue: 220,
    flourish: "sparkle",
    statLabels: ["Chaos", "Laughs", "Feuds"],
    cards: [
      { id: "codenames", title: "Codenames", meta: "Czech Games Edition", icon: "fa-user-secret", take: "One-word clues, zero chill. I'm always the spymaster.", stats: [7, 9, 4], fun: "Assassin cards hit: 3" },
      { id: "wavelength", title: "Wavelength", meta: "Also in the ops console", icon: "fa-wave-square", take: "I built my own version, so obviously it's rigged.", stats: [6, 10, 5], fun: "Bullseyes on my own dial: suspicious" },
      { id: "mariokart", title: "Mario Kart 8", meta: "2014 · Nintendo", icon: "fa-flag-checkered", take: "Blue shells are a character-building exercise.", stats: [10, 10, 9], fun: "Blue shells taken: a personal record" },
      { id: "catan", title: "Catan", meta: "Klaus Teuber · 1995", icon: "fa-wheat-awn", take: "I have wood for sheep. I always have wood for sheep.", stats: [6, 7, 10], fun: "Longest-road disputes: 12" },
      { id: "fishbowl", title: "Fishbowl", meta: "Also in the ops console", icon: "fa-fish", take: "Three rounds, one bowl, every inside joke ever.", stats: [9, 10, 3], fun: "Charades rounds lost: all" },
    ],
  },
];

/** The bonus pack, unlocked by collecting the whole set. */
export const SECRET_PACK = {
  id: "bugs",
  name: "Bugs Shipped",
  tagline: "Top 5 Bugs I've Shipped",
  kind: "Incident",
  icon: "fa-bug",
  hue: 300,
  flourish: "scan",
  secret: true,
  statLabels: ["Severity", "Shame", "Lessons"],
  cards: [
    { id: "worksonmymachine", title: "It Works On My Machine", meta: "Every project, eventually", icon: "fa-laptop-code", take: "Legendary for a reason. Comes with a free 'it worked yesterday'.", stats: [10, 8, 10], fun: "Machines it worked on: 1" },
    { id: "offbyone", title: "Off-By-One (Again)", meta: "for (i = 0; i <= n; i++)", icon: "fa-list-ol", take: "Two hard problems: naming, cache invalidation, off-by-one.", stats: [7, 9, 8], fun: "Loops affected: n + 1" },
    { id: "timezone", title: "Timezone Tuesday", meta: "Worked fine in UTC", icon: "fa-clock", take: "Worked perfectly. In UTC. For nobody.", stats: [8, 8, 9], fun: "Hours lost: -5 (EST)" },
    { id: "zindex", title: "z-index: 99999", meta: "CSS, obviously", icon: "fa-layer-group", take: "It's on top now. Everything is on top now.", stats: [5, 10, 6], fun: "Stacking contexts understood: 0" },
    { id: "semicolon", title: "The Missing Semicolon", meta: "Three hours, one character", icon: "fa-circle-exclamation", take: "Three hours of debugging. One character.", stats: [3, 7, 10], fun: "Characters at fault: 1" },
  ],
};

/** Easter eggs, found per browser. Hints show on the secrets row. */
export const SECRETS = [
  { id: "godpack", label: "God Pack", icon: "fa-gamepad", hint: "An old cheat code still works here." },
  { id: "shiny", label: "Shiny Hunter", icon: "fa-wand-magic-sparkles", hint: "Say the word collectors love." },
  { id: "yard", label: "Yard Jockey", icon: "fa-truck", hint: "Where the day job parks its trailers." },
  { id: "shark", label: "Card Shark", icon: "fa-hand-sparkles", hint: "Spin a card. Harder." },
  { id: "bugs", label: "Bug Collector", icon: "fa-bug", hint: "Finish the set." },
];

export const TOTAL_CARDS = PACKS.length * CARDS_PER_PACK;

export const rarityOf = (rank) => RARITY[rank];

/** Fan position of a rank: #5 sits far left (0), #1 far right (4). */
export const fanIndex = (rank) => CARDS_PER_PACK - rank;
export const rankAt = (fanIdx) => CARDS_PER_PACK - fanIdx;

const pad = (n) => String(n).padStart(3, "0");

export const collectorNo = (pack, rank) => {
  if (pack.secret) return `${SET.code}-S${String(rank).padStart(2, "0")}`;
  const index = PACKS.findIndex((p) => p.id === pack.id);
  return `${SET.code}-${pad(index * CARDS_PER_PACK + rank)}/${pad(TOTAL_CARDS)}`;
};

export const packById = (id) =>
  id === SECRET_PACK.id ? SECRET_PACK : PACKS.find((p) => p.id === id);

export const allBaseOpened = (opened) => PACKS.every((p) => Boolean(opened[p.id]));

/**
 * Packs on the shelf, in shelf order. The bonus pack joins once earned.
 * Pass a catalog (buildCatalog) to get the owner's edited packs.
 */
export const visiblePacks = (opened, bonusUnlocked, catalog) => {
  const base = catalog || { packs: PACKS, secret: SECRET_PACK };
  return bonusUnlocked || allBaseOpened(opened) ? [...base.packs, base.secret] : base.packs;
};

/** Cards collected from the base set (the bonus pack doesn't count). */
export const collectedCount = (opened) =>
  PACKS.filter((p) => Boolean(opened[p.id])).length * CARDS_PER_PACK;

const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Stored "opened" state is external input: keep only known packs with a date. */
export const sanitizeOpened = (raw) => {
  if (!isPlainObject(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([id, v]) => packById(id) && isPlainObject(v) && typeof v.pulledAt === "string"
    )
  );
};

/** Stored secrets: known ids only, no duplicates. */
export const sanitizeSecrets = (raw) => {
  if (!Array.isArray(raw)) return [];
  const known = new Set(SECRETS.map((s) => s.id));
  return [...new Set(raw.filter((id) => typeof id === "string" && known.has(id)))];
};

// ---- owner edits (saved from the back office through /api/top5) ----

export const ICON_RE = /^fa-[a-z0-9-]{1,40}$/;
const ID_RE = /^[a-z0-9-]{1,40}$/;
// Same cleaning as the API: zero-width spaces, direction marks and bidi
// overrides vanish (emoji joiners stay), other control characters become
// spaces, whitespace collapses.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export const cleanText = (value) =>
  typeof value === "string"
    ? value.replace(INVISIBLE, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim()
    : null;

const fits = (text, max, required = true) =>
  text !== null && text.length <= max && (!required || text.length > 0);

const cleanCard = (raw, seen) => {
  if (!isPlainObject(raw) || typeof raw.id !== "string" || !ID_RE.test(raw.id) || seen.has(raw.id)) {
    return null;
  }
  if (typeof raw.icon !== "string" || !ICON_RE.test(raw.icon)) return null;
  const card = {
    id: raw.id,
    title: cleanText(raw.title),
    meta: cleanText(raw.meta ?? ""),
    icon: raw.icon,
    take: cleanText(raw.take),
    stats: raw.stats,
    fun: cleanText(raw.fun ?? ""),
  };
  const textOk =
    fits(card.title, LIMITS.title) &&
    fits(card.meta, LIMITS.meta, false) &&
    fits(card.take, LIMITS.take) &&
    fits(card.fun, LIMITS.fun, false);
  const statsOk =
    Array.isArray(card.stats) &&
    card.stats.length === 3 &&
    card.stats.every((v) => Number.isInteger(v) && v >= 0 && v <= 10);
  return textOk && statsOk ? { ...card, stats: [...card.stats] } : null;
};

/**
 * Validate one stored pack edit ({ name, tagline, statLabels, cards }).
 * All-or-nothing: anything malformed returns null and the pack keeps its
 * defaults, so a bad row can never break a card.
 */
export const sanitizePackEdit = (raw) => {
  if (!isPlainObject(raw)) return null;
  const name = cleanText(raw.name);
  const tagline = cleanText(raw.tagline);
  if (!fits(name, LIMITS.packName) || !fits(tagline, LIMITS.tagline)) return null;
  if (!Array.isArray(raw.statLabels) || raw.statLabels.length !== 3) return null;
  const statLabels = raw.statLabels.map(cleanText);
  if (!statLabels.every((l) => fits(l, LIMITS.statLabel))) return null;
  if (!Array.isArray(raw.cards) || raw.cards.length !== CARDS_PER_PACK) return null;
  const seen = new Set();
  const cards = [];
  for (const rawCard of raw.cards) {
    const card = cleanCard(rawCard, seen);
    if (!card) return null;
    seen.add(card.id);
    cards.push(card);
  }
  return { name, tagline, statLabels, cards };
};

/**
 * The shipped set with the owner's saved edits laid over it. Edits only
 * replace a pack's contents; its id, hue, icon and flourish stay put (they
 * key the shelf order and every visitor's opened state).
 */
export const buildCatalog = (overrides = {}) => {
  const edits = isPlainObject(overrides) ? overrides : {};
  const apply = (pack) => {
    const edit = Object.prototype.hasOwnProperty.call(edits, pack.id)
      ? sanitizePackEdit(edits[pack.id])
      : null;
    return edit ? { ...pack, ...edit, edited: true } : pack;
  };
  const packs = PACKS.map(apply);
  const secret = apply(SECRET_PACK);
  return { packs, secret, byId: new Map([...packs, secret].map((p) => [p.id, p])) };
};
