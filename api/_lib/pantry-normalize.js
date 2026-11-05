// Validation for /api/pantry. Pure, so it's unit tested without a database.
// NOT an endpoint.
//
// Everything that crosses the wire is checked here. That covers Claude's
// read of a receipt as well as what the page sends: the model's JSON goes
// through sanitizeRead() before anyone sees it, so an odd answer becomes a
// blank field to fill in, never a bad row.
const CATEGORIES = [
  "produce",
  "dairy",
  "meat",
  "seafood",
  "bakery",
  "pantry",
  "frozen",
  "snacks",
  "drinks",
  "household",
  "other",
];
// "home" is for non-food supplies (paper towels, dish soap).
const LOCATIONS = ["fridge", "freezer", "pantry", "counter", "home"];

const MAX_QTY = 999;
const MAX_LINES = 120;
const MAX_NAME = 60;
const MAX_PHOTOS = 4;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;
// Vercel caps a request body at 4.5MB; base64 photos must fit under it.
const MAX_TOTAL_BASE64 = 4.2 * 1024 * 1024;
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The uniqueness key for an item name: case, accents and punctuation folded. */
function nameKey(name) {
  return str(name, MAX_NAME)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

/** The key a receipt's printed text is remembered under ("NN 2% MLK 4L"). */
function aliasKey(raw) {
  return str(raw, 80)
    .toUpperCase()
    .replace(/[^A-Z0-9%]+/g, " ")
    .trim();
}

function cleanName(v) {
  const s = str(v, MAX_NAME);
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

/** A quantity in packs: 0 to 999, kept to quarter steps. */
function cleanQty(v, { min = 0, fallback = null } = {}) {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > MAX_QTY) return fallback;
  return Math.round(n * 4) / 4;
}

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);

function cleanInt(v, min, max) {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function validDay(v) {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && v >= "2000-01-01";
}

const positiveId = (v) => cleanInt(v, 1, 2147483647);

// ---------------------------------------------------------------------------
// Receipt photos

function validateImages(body) {
  const list = body && Array.isArray(body.images) ? body.images : null;
  if (!list || !list.length) return fail("Add a photo of the receipt.");
  if (list.length > MAX_PHOTOS) return fail(`Up to ${MAX_PHOTOS} photos per receipt.`);
  let total = 0;
  const value = [];
  for (const photo of list) {
    const mediaType = photo && photo.mediaType;
    const image = photo && photo.image;
    if (!IMAGE_TYPES.includes(mediaType)) return fail("Upload JPEG, PNG or WebP photos.");
    if (typeof image !== "string" || image.length < 100 || !BASE64_RE.test(image)) {
      return fail("A photo didn't come through. Try again.");
    }
    if (Math.floor((image.length * 3) / 4) > MAX_IMAGE_BYTES) {
      return fail("One of those photos is too large. Try again with a smaller one.");
    }
    total += image.length;
    value.push({ image, mediaType });
  }
  if (total > MAX_TOTAL_BASE64) return fail("Those photos are too large together. Try fewer.");
  return ok(value);
}

/**
 * Claude's read of a receipt, made safe to show. Unknown match ids are
 * dropped (the model can only point at items that exist), and anything
 * malformed falls back to a blank the review screen asks about.
 * @param {object} raw the model's JSON
 * @param {{ id: number }[]} items every known item, archived included
 */
function sanitizeRead(raw, items, today) {
  const known = new Set(items.map((i) => i.id));
  const src = raw && typeof raw === "object" ? raw : {};
  const lines = (Array.isArray(src.lines) ? src.lines : []).slice(0, MAX_LINES).flatMap((l) => {
    if (!l || typeof l !== "object") return [];
    const rawText = str(l.raw, 80);
    const name = cleanName(l.name) || cleanName(rawText);
    if (!name) return [];
    const matchId = known.has(l.matchId) ? l.matchId : null;
    return [
      {
        raw: rawText,
        name,
        matchId,
        category: pick(l.category, CATEGORIES, "other"),
        location: pick(l.location, LOCATIONS, "pantry"),
        qty: cleanQty(l.qty, { min: 0.25, fallback: 1 }),
        size: str(l.size, 24) || null,
        priceCents: cleanInt(l.priceCents, -100000, 100000),
        shelfDays: cleanInt(l.shelfDays, 1, 3650),
        keep: l.keep !== false,
      },
    ];
  });
  const day = validDay(src.purchasedOn) && (!today || src.purchasedOn <= today) ? src.purchasedOn : null;
  return {
    store: str(src.store, 60) || null,
    purchasedOn: day,
    totalCents: cleanInt(src.totalCents, 0, 10000000),
    lines,
  };
}

/** A reviewed receipt, ready to save. */
function validateReceipt(body, today) {
  const b = body && typeof body === "object" ? body : {};
  const purchasedOn = b.purchasedOn;
  if (!validDay(purchasedOn)) return fail("Pick the day you shopped.");
  if (today && purchasedOn > today) return fail("That shopping day is in the future.");
  const list = Array.isArray(b.lines) ? b.lines : [];
  if (!list.length) return fail("There's nothing to add. Keep at least one line.");
  if (list.length > MAX_LINES) return fail(`A receipt can have up to ${MAX_LINES} lines.`);

  const lines = [];
  for (const l of list) {
    if (!l || typeof l !== "object") return fail("One of the lines didn't come through.");
    const itemId = l.itemId == null ? null : positiveId(l.itemId);
    const name = cleanName(l.name);
    if (!itemId && !name) return fail("Every new item needs a name.");
    const qty = cleanQty(l.qty, { min: 0.25 });
    if (qty == null) return fail(`Check the amount for ${name || "an item"}.`);
    lines.push({
      raw: str(l.raw, 80),
      itemId,
      name,
      key: nameKey(name),
      category: pick(l.category, CATEGORIES, "other"),
      location: pick(l.location, LOCATIONS, "pantry"),
      qty,
      priceCents: cleanInt(l.priceCents, -100000, 100000),
      shelfDays: cleanInt(l.shelfDays, 1, 3650),
    });
  }
  return ok({
    store: str(b.store, 60) || null,
    purchasedOn,
    totalCents: cleanInt(b.totalCents, 0, 10000000),
    force: b.force === true,
    lines,
  });
}

/**
 * Group a receipt's lines by the item they land on. Lines pointing at an id
 * that no longer exists, or naming an item that already exists, are folded
 * onto the existing item; two "Bananas" lines become one restock.
 * @param {object[]} lines validated lines
 * @param {{ id: number, name: string }[]} items every known item
 */
function planReceipt(lines, items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const byKey = new Map(items.map((i) => [nameKey(i.name), i]));
  const existing = new Map();
  const fresh = new Map();
  const aliases = new Map();

  for (const line of lines) {
    const target = (line.itemId && byId.get(line.itemId)) || byKey.get(line.key) || null;
    const priced = (prev) => (line.priceCents == null ? prev ?? null : (prev || 0) + line.priceCents);
    if (target) {
      const prev = existing.get(target.id);
      existing.set(target.id, {
        item_id: target.id,
        qty: Math.min(MAX_QTY, (prev ? prev.qty : 0) + line.qty),
        price_cents: priced(prev && prev.price_cents),
        shelf_days: (prev && prev.shelf_days) || line.shelfDays,
      });
      if (line.raw) aliases.set(aliasKey(line.raw), nameKey(target.name));
    } else {
      const prev = fresh.get(line.key);
      fresh.set(line.key, {
        name: prev ? prev.name : line.name,
        name_key: line.key,
        category: prev ? prev.category : line.category,
        location: prev ? prev.location : line.location,
        qty: Math.min(MAX_QTY, (prev ? prev.qty : 0) + line.qty),
        price_cents: priced(prev && prev.price_cents),
        shelf_days: (prev && prev.shelf_days) || line.shelfDays,
      });
      if (line.raw) aliases.set(aliasKey(line.raw), line.key);
    }
  }

  const aliasRows = [...aliases].filter(([k]) => k).map(([raw_key, name_key]) => ({ raw_key, name_key }));
  const existingRows = [...existing.values()];
  const freshRows = [...fresh.values()];
  const keys = [
    ...new Set([...freshRows.map((f) => f.name_key), ...existingRows.map((e) => nameKey(byId.get(e.item_id).name))]),
  ];
  return { existing: existingRows, fresh: freshRows, aliases: aliasRows, keys };
}

/** Same store, day and total means the same receipt. Null when there's no total. */
function receiptFingerprint({ store, purchasedOn, totalCents }) {
  if (totalCents == null) return null;
  return `${nameKey(store || "")}|${purchasedOn}|${totalCents}`;
}

// ---------------------------------------------------------------------------
// Items, quick actions, the list

const OPS = {
  use: "used",
  add: "bought",
  set: "set",
  low: "low",
  out: "out",
};

function validateAdjust(body) {
  const b = body && typeof body === "object" ? body : {};
  const id = positiveId(b.id);
  if (!id) return fail("Which item?");
  if (!Object.prototype.hasOwnProperty.call(OPS, b.op)) return fail("Unknown change.");
  let n = 1;
  if (b.op === "set") {
    n = cleanQty(b.qty);
    if (n == null) return fail(`Amounts go from 0 to ${MAX_QTY}.`);
  } else if (b.op === "use" || b.op === "add") {
    n = b.qty == null ? 1 : cleanQty(b.qty, { min: 0.25 });
    if (n == null) return fail(`Amounts go from 0 to ${MAX_QTY}.`);
  }
  return ok({ id, op: b.op, n, kind: OPS[b.op] });
}

function validateItem(body) {
  const src = body && typeof body.item === "object" && body.item ? body.item : {};
  const id = src.id == null ? null : positiveId(src.id);
  if (src.id != null && !id) return fail("Which item?");
  const name = cleanName(src.name);
  if (!name) return fail("Give it a name.");
  const key = nameKey(name);
  if (!key) return fail("Give it a name with some letters in it.");
  const lowAt = src.lowAt == null ? 0.25 : cleanQty(src.lowAt);
  if (lowAt == null) return fail(`The low mark goes from 0 to ${MAX_QTY}.`);
  const qty = src.qty == null ? 0 : cleanQty(src.qty);
  if (qty == null) return fail(`Amounts go from 0 to ${MAX_QTY}.`);
  let shelfDays = null;
  if (src.shelfDays != null && src.shelfDays !== "") {
    shelfDays = cleanInt(src.shelfDays, 1, 3650);
    if (shelfDays == null) return fail("Shelf life is in days, from 1 to 3650.");
  }
  return ok({
    id,
    name,
    key,
    category: pick(src.category, CATEGORIES, "other"),
    location: pick(src.location, LOCATIONS, "pantry"),
    qty,
    lowAt,
    staple: src.staple === true ? true : src.staple === false ? false : null,
    shelfDays,
  });
}

function validateDismiss(body) {
  const b = body && typeof body === "object" ? body : {};
  const id = positiveId(b.id);
  if (!id) return fail("Which item?");
  if (b.mode !== "snooze" && b.mode !== "archive") return fail("Unknown change.");
  return ok({ id, mode: b.mode });
}

function validateExtra(body) {
  const name = cleanName(body && body.name);
  if (!name || !nameKey(name)) return fail("What do you need?");
  return ok({ name, key: nameKey(name) });
}

/** A recipe's aftermath: per item, nothing changed, running low, or gone. */
function validateCooked(body) {
  const list = body && Array.isArray(body.uses) ? body.uses : [];
  const uses = [];
  const seen = new Set();
  for (const u of list.slice(0, 30)) {
    const id = positiveId(u && u.id);
    if (!id || seen.has(id)) continue;
    if (u.op !== "low" && u.op !== "out") continue; // "still plenty" needs no write
    seen.add(id);
    uses.push({ id, op: u.op, n: 1, kind: "cooked" });
  }
  return ok(uses);
}

// ---------------------------------------------------------------------------
// Recipes

function validateRecipeAsk(body) {
  return ok({ ask: str(body && body.ask, 200) });
}

/** Claude's recipes, trimmed to what the cards can show; uses must be real items. */
function sanitizeRecipes(raw, items) {
  const known = new Set(items.map((i) => i.id));
  const list = raw && Array.isArray(raw.recipes) ? raw.recipes : [];
  return list.slice(0, 6).flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const title = str(r.title, 80);
    const steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => str(s, 400)).filter(Boolean).slice(0, 20);
    if (!title || !steps.length) return [];
    const seen = new Set();
    const uses = (Array.isArray(r.uses) ? r.uses : []).flatMap((u) => {
      if (!u || !known.has(u.itemId) || seen.has(u.itemId)) return [];
      seen.add(u.itemId);
      return [{ itemId: u.itemId, amount: str(u.amount, 40) }];
    });
    return [
      {
        title,
        blurb: str(r.blurb, 240),
        minutes: cleanInt(r.minutes, 1, 600),
        servings: cleanInt(r.servings, 1, 20),
        uses,
        missing: (Array.isArray(r.missing) ? r.missing : []).map((m) => cleanName(m)).filter(Boolean).slice(0, 10),
        steps,
        tags: (Array.isArray(r.tags) ? r.tags : []).map((t) => str(t, 24)).filter(Boolean).slice(0, 5),
      },
    ];
  });
}

module.exports = {
  CATEGORIES,
  LOCATIONS,
  MAX_PHOTOS,
  nameKey,
  aliasKey,
  cleanQty,
  validDay,
  validateImages,
  sanitizeRead,
  validateReceipt,
  planReceipt,
  receiptFingerprint,
  validateAdjust,
  validateItem,
  validateDismiss,
  validateExtra,
  validateCooked,
  validateRecipeAsk,
  sanitizeRecipes,
};
