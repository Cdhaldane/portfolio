// Vercel serverless function — /api/pantry (the private /pantry kitchen app).
//
//   GET                          → stock with status, list extras, recent receipts,
//                                  the last recipe ideas, push + kitchen settings
//   GET ?kitchen=<token>         → the kitchen feed, read-only and sign-in free:
//                                  out / low / use soon / extras + a sentence to say
//                                  aloud (Home Assistant → the Nest speaker)
//   GET + Bearer <CRON_SECRET>   → the daily reminder push. The Vercel cron calls
//                                  plain /api/pantry; the secret is what marks it,
//                                  and a Clerk token can never equal it. ?cron=1
//                                  routes here too, for a manual run.
//   POST { action: "read", images: [{ image, mediaType }] }
//                                → Claude's read of a receipt (NOT saved)
//   POST { action: "receipt", store, purchasedOn, totalCents, lines, force? }
//                                → save a reviewed receipt: restocks + new items
//   POST { action: "adjust", id, op, qty? }      → used one / bought one / low / out / set
//   POST { action: "dismiss", id, mode }         → off the list: "snooze" a week or "archive"
//   POST { action: "item", item }                → add or edit an item
//   POST { action: "extra", name }               → add a free-text list entry
//   POST { action: "recipes", ask? }             → Claude's recipe ideas from the stock
//   POST { action: "cooked", uses: [{ id, op }] } → after cooking: what ran low or out
//   POST { action: "push", subscription }        → reminders on for this phone
//   DELETE ?id= | ?receiptId= | ?extraId= | ?push=<endpoint>
//
// Same shape as /api/bowler: requireUser() first for everything a person
// does. The kitchen feed and the cron check their own secrets instead, and
// both fail closed. One file, one function: this is the 12th and last slot
// on the Hobby plan.
const crypto = require("crypto");
const { requireUser, sendAuthError, HttpError } = require("./_lib/budget-auth");
const db = require("./_lib/pantry-db");
const {
  aliasKey,
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
} = require("./_lib/pantry-normalize");
const { todayIn, withStatus, statusOf, kitchenSummary, digestFor } = require("./_lib/pantry-stock");
const { readReceipt, suggestRecipes } = require("./_lib/pantry-claude");
const push = require("./_lib/pantry-push");

// Claude calls cost real money, so cap them per user per warm instance. Not
// a global limit (instances don't share memory), but plenty for a household
// and a hard stop on a runaway retry loop.
const CALL_LIMIT = 10;
const CALL_WINDOW_MS = 10 * 60 * 1000;
const callLog = new Map();

function allowCall(key, now = Date.now()) {
  const recent = (callLog.get(key) || []).filter((t) => now - t < CALL_WINDOW_MS);
  if (recent.length >= CALL_LIMIT) {
    callLog.set(key, recent);
    return false;
  }
  callLog.set(key, [...recent, now]);
  return true;
}

/** Constant-time compare for the kitchen token and the cron secret. */
function sameSecret(given, expected) {
  if (!expected || typeof given !== "string" || !given) return false;
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const kitchenToken = () => process.env.PANTRY_KITCHEN_TOKEN || "";

const bearer = (req) => String(req.headers["authorization"] || "").replace(/^Bearer /, "");
const isCron = (req) =>
  (req.query && req.query.cron !== undefined) || sameSecret(bearer(req), process.env.CRON_SECRET);

function requireSql() {
  const sql = db.getSql();
  if (!sql) throw new HttpError(503, { error: "The database isn't configured yet." });
  return sql;
}

async function snapshot(sql, today) {
  const [items, extras, receipts] = await Promise.all([
    db.listItems(sql),
    db.listExtras(sql),
    db.listReceipts(sql),
  ]);
  return { today, items: withStatus(items, today), extras, receipts };
}

const withOneStatus = (item, today) => (item ? { ...item, status: statusOf(item, today) } : null);

// ---------------------------------------------------------------------------
// Sign-in free: the kitchen feed and the cron

async function handleKitchen(req, res) {
  // A missing or wrong token looks the same as no such thing.
  if (!sameSecret(String(req.query.kitchen || ""), kitchenToken())) {
    return res.status(404).json({ error: "Not found" });
  }
  const sql = requireSql();
  await db.ensurePantryTables(sql);
  const today = todayIn();
  const [items, extras] = await Promise.all([db.listItems(sql), db.listExtras(sql)]);
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, ...kitchenSummary(withStatus(items, today), extras, today) });
}

async function handleCron(req, res) {
  if (!process.env.CRON_SECRET) {
    return res.status(503).json({ error: "CRON_SECRET isn't configured, so reminders are off." });
  }
  if (!sameSecret(bearer(req), process.env.CRON_SECRET)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const sql = requireSql();
  await db.ensurePantryTables(sql);
  const today = todayIn();
  if ((await db.getMeta(sql, "digest:last")) === today) {
    return res.status(200).json({ ok: true, skipped: "already sent today" });
  }
  const [items, extras, seen] = await Promise.all([
    db.listItems(sql),
    db.listExtras(sql),
    db.getMeta(sql, "digest:seen"),
  ]);
  const { payload, keys } = digestFor(withStatus(items, today), extras, today, seen || []);
  // Mark first: a crash mid-send must not mean a second round today.
  await db.setMeta(sql, "digest:last", today);
  await db.setMeta(sql, "digest:seen", keys);
  if (!payload) return res.status(200).json({ ok: true, skipped: "nothing new" });
  const result = await push.sendAll(await db.listPush(sql), payload, {
    drop: (endpoint) => db.deletePush(sql, endpoint),
  });
  return res.status(200).json({ ok: true, ...result });
}

// ---------------------------------------------------------------------------
// Signed in

async function handleGet(res, sql, today) {
  const [snap, recipes] = await Promise.all([snapshot(sql, today), db.getMeta(sql, "recipes:last")]);
  const token = kitchenToken();
  return res.status(200).json({
    ok: true,
    ...snap,
    recipes: recipes || null,
    push: { enabled: push.configured(), publicKey: push.publicKey() },
    kitchen: token ? { path: `/pantry/kitchen?k=${encodeURIComponent(token)}` } : null,
  });
}

async function handleRead(res, sql, userId, body, today) {
  const photos = validateImages(body);
  if (!photos.ok) return res.status(400).json({ error: photos.error });
  if (!allowCall(`read:${userId}`)) {
    return res.status(429).json({ error: "That's a lot of receipts at once. Give it a few minutes." });
  }
  const [items, aliases] = await Promise.all([
    db.listItems(sql, { includeArchived: true }),
    db.listAliases(sql),
  ]);
  const raw = await readReceipt(photos.value, items.map((i) => ({ id: i.id, name: i.name })));
  const read = sanitizeRead(raw, items, today);
  // A match the household confirmed on an earlier receipt beats the model's guess.
  const byId = new Map(items.map((i) => [i.id, i]));
  read.lines = read.lines.map((line) => {
    const learned = aliases.get(aliasKey(line.raw));
    const matchId = learned && byId.has(learned) ? learned : line.matchId;
    return { ...line, matchId, matchName: matchId ? byId.get(matchId).name : null };
  });
  return res.status(200).json({ ok: true, read });
}

async function handleReceipt(res, sql, userId, body, today) {
  const parsed = validateReceipt(body, today);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const receipt = parsed.value;
  const fingerprint = receiptFingerprint(receipt);
  if (!receipt.force) {
    const dupe = await db.findReceipt(sql, fingerprint);
    if (dupe) {
      return res.status(409).json({
        error: "This receipt looks like one you've already added.",
        code: "duplicate",
        purchasedOn: dupe.purchasedOn,
      });
    }
  }
  const items = await db.listItems(sql, { includeArchived: true });
  const plan = planReceipt(receipt.lines, items);
  const saved = await db.saveReceipt(sql, userId, receipt, plan, fingerprint);
  return res.status(200).json({
    ok: true,
    saved: { ...saved, restocked: plan.existing.length, added: plan.fresh.length },
    ...(await snapshot(sql, today)),
  });
}

/** Tell everyone else when something newly needs buying. */
async function notifyOthers(sql, userId, before, after) {
  const was = before.state === "out" || before.state === "low";
  const now = after.status.state === "out" || after.status.state === "low";
  if (was || !now || !after.status.onList) return;
  const subs = (await db.listPush(sql)).filter((s) => s.userId !== userId);
  await push.sendAll(subs, push.markedPayload(after, after.status.state), {
    drop: (endpoint) => db.deletePush(sql, endpoint),
  });
}

async function adjustAndNotify(sql, userId, change, today) {
  const changed = await db.adjustItem(sql, userId, change, today);
  if (!changed) return null;
  const item = withOneStatus(await db.getItem(sql, change.id), today);
  const before = statusOf({ ...item, qty: item.qty - Number(changed.qty_delta) }, today);
  try {
    await notifyOthers(sql, userId, before, item);
  } catch (err) {
    console.error("Pantry push error:", err); // a failed heads-up never fails the change
  }
  return item;
}

async function handleAdjust(res, sql, userId, body, today) {
  const parsed = validateAdjust(body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const item = await adjustAndNotify(sql, userId, parsed.value, today);
  if (!item) return res.status(404).json({ error: "That item is gone. Pull to refresh." });
  return res.status(200).json({ ok: true, item });
}

async function handleCooked(res, sql, userId, body, today) {
  const uses = validateCooked(body).value;
  const items = [];
  for (const change of uses) {
    const item = await adjustAndNotify(sql, userId, change, today);
    if (item) items.push(item);
  }
  return res.status(200).json({ ok: true, items });
}

async function handleDismiss(res, sql, body, today) {
  const parsed = validateDismiss(body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  if (!(await db.dismissItem(sql, parsed.value, today))) {
    return res.status(404).json({ error: "That item is gone. Pull to refresh." });
  }
  return res.status(200).json({ ok: true, item: withOneStatus(await db.getItem(sql, parsed.value.id), today) });
}

async function handleItem(res, sql, userId, body, today) {
  const parsed = validateItem(body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const id = await db.saveItem(sql, userId, parsed.value);
  if (id === null) return res.status(409).json({ error: `There's already a "${parsed.value.name}".` });
  if (id === undefined) return res.status(404).json({ error: "That item is gone. Pull to refresh." });
  return res.status(200).json({ ok: true, item: withOneStatus(await db.getItem(sql, id), today) });
}

async function handleExtra(res, sql, userId, body) {
  const parsed = validateExtra(body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  await db.addExtra(sql, userId, parsed.value);
  return res.status(200).json({ ok: true, extras: await db.listExtras(sql) });
}

async function handleRecipes(res, sql, userId, body, today) {
  const { ask } = validateRecipeAsk(body).value;
  const items = withStatus(await db.listItems(sql), today).filter(
    (i) => i.qty > 0 && i.location !== "home"
  );
  if (items.length < 3) {
    return res.status(400).json({ error: "Add a few more things to the pantry first." });
  }
  if (!allowCall(`recipes:${userId}`)) {
    return res.status(429).json({ error: "That's a lot of ideas at once. Give it a few minutes." });
  }
  // Things to use soon first, so they survive the cap.
  const stock = [...items]
    .sort((a, b) => Number(b.status.useSoon) - Number(a.status.useSoon))
    .slice(0, 250);
  const recipes = sanitizeRecipes(await suggestRecipes(stock, ask, today), items);
  if (!recipes.length) {
    return res.status(422).json({ error: "Couldn't come up with recipes just now. Try again." });
  }
  const saved = { at: new Date().toISOString(), ask, recipes };
  await db.setMeta(sql, "recipes:last", saved);
  return res.status(200).json({ ok: true, recipes: saved });
}

async function handlePush(res, sql, userId, body) {
  const sub = push.validSubscription(body.subscription);
  if (!sub) return res.status(400).json({ error: "That subscription didn't come through." });
  await db.savePush(sql, userId, sub);
  return res.status(200).json({ ok: true });
}

async function handleDelete(req, res, sql, today) {
  const q = req.query || {};
  if (q.push !== undefined) {
    await db.deletePush(sql, String(q.push));
    return res.status(200).json({ ok: true });
  }
  const kind = q.receiptId !== undefined ? "receipt" : q.extraId !== undefined ? "extra" : "item";
  const id = Number(kind === "receipt" ? q.receiptId : kind === "extra" ? q.extraId : q.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Which one?" });
  if (kind === "extra") {
    await db.deleteExtra(sql, id);
    return res.status(200).json({ ok: true, extras: await db.listExtras(sql) });
  }
  const removed = kind === "receipt" ? await db.deleteReceipt(sql, id) : await db.deleteItem(sql, id);
  if (!removed) return res.status(404).json({ error: "That's already gone." });
  return res.status(200).json({ ok: true, ...(await snapshot(sql, today)) });
}

module.exports = async (req, res) => {
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (req.method === "GET" && req.query && req.query.kitchen !== undefined) {
      return await handleKitchen(req, res);
    }
    if (req.method === "GET" && isCron(req)) {
      return await handleCron(req, res);
    }
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.payload);
    console.error("Pantry API error:", err);
    return res.status(500).json({ error: "Something went wrong." });
  }

  let userId;
  try {
    // PANTRY_ALLOWED_USER_IDS narrows the pantry to one household; without
    // it the pantry shares the private apps' allowlist.
    const allowlistEnv = process.env.PANTRY_ALLOWED_USER_IDS
      ? "PANTRY_ALLOWED_USER_IDS"
      : "BUDGET_ALLOWED_USER_IDS";
    ({ userId } = await requireUser(req, { allowlistEnv, product: "Pantry" }));
  } catch (err) {
    return sendAuthError(res, err);
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const today = todayIn();

  try {
    const sql = requireSql();
    await db.ensurePantryTables(sql);

    if (req.method === "GET") return await handleGet(res, sql, today);
    if (req.method === "DELETE") return await handleDelete(req, res, sql, today);

    switch (body.action) {
      case "read":
        return await handleRead(res, sql, userId, body, today);
      case "receipt":
        return await handleReceipt(res, sql, userId, body, today);
      case "adjust":
        return await handleAdjust(res, sql, userId, body, today);
      case "cooked":
        return await handleCooked(res, sql, userId, body, today);
      case "dismiss":
        return await handleDismiss(res, sql, body, today);
      case "item":
        return await handleItem(res, sql, userId, body, today);
      case "extra":
        return await handleExtra(res, sql, userId, body);
      case "recipes":
        return await handleRecipes(res, sql, userId, body, today);
      case "push":
        return await handlePush(res, sql, userId, body);
      default:
        return res.status(400).json({ error: "Unknown action." });
    }
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json(err.payload);
    console.error("Pantry API error:", err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
