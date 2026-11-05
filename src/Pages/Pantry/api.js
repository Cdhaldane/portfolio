// /api/pantry calls. Reuses Budgetter's never-rejecting fetch wrapper, which
// attaches the Clerk session token to every request.
import { budgetFetch } from "../Budgetter/api";

const PATH = "/api/pantry";

const fail = (res, data, fallback) => ({
  ok: false,
  error: (data && data.error) || (res.status === 0 ? "You look offline. Try again." : fallback),
  code: data && data.code,
  data,
});

const post = (getToken, body) =>
  budgetFetch(getToken, PATH, { method: "POST", body: JSON.stringify(body) });

/** Everything the page shows, in one round trip. */
export async function loadPantry(getToken) {
  const { res, data } = await budgetFetch(getToken, PATH);
  return res.ok ? { ok: true, data } : fail(res, data, "Couldn't open the pantry.");
}

export async function readReceipt(getToken, images) {
  const { res, data } = await post(getToken, { action: "read", images });
  return res.ok ? { ok: true, read: data.read } : fail(res, data, "Couldn't read that receipt.");
}

export async function saveReceipt(getToken, receipt) {
  const { res, data } = await post(getToken, { action: "receipt", ...receipt });
  return res.ok ? { ok: true, data } : fail(res, data, "Couldn't save that receipt.");
}

export async function adjust(getToken, id, op, qty) {
  const { res, data } = await post(getToken, { action: "adjust", id, op, qty });
  return res.ok ? { ok: true, item: data.item } : fail(res, data, "Couldn't update that.");
}

export async function dismiss(getToken, id, mode) {
  const { res, data } = await post(getToken, { action: "dismiss", id, mode });
  return res.ok ? { ok: true, item: data.item } : fail(res, data, "Couldn't update that.");
}

export async function saveItem(getToken, item) {
  const { res, data } = await post(getToken, { action: "item", item });
  return res.ok ? { ok: true, item: data.item } : fail(res, data, "Couldn't save that.");
}

export async function deleteItem(getToken, id) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok ? { ok: true, data } : fail(res, data, "Couldn't delete that.");
}

export async function addExtra(getToken, name) {
  const { res, data } = await post(getToken, { action: "extra", name });
  return res.ok ? { ok: true, extras: data.extras } : fail(res, data, "Couldn't add that.");
}

export async function deleteExtra(getToken, id) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?extraId=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok ? { ok: true, extras: data.extras } : fail(res, data, "Couldn't take that off.");
}

export async function undoReceipt(getToken, id) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?receiptId=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok ? { ok: true, data } : fail(res, data, "Couldn't undo that receipt.");
}

export async function suggestRecipes(getToken, ask) {
  const { res, data } = await post(getToken, { action: "recipes", ask });
  return res.ok ? { ok: true, recipes: data.recipes } : fail(res, data, "Couldn't get recipes.");
}

export async function cooked(getToken, uses) {
  const { res, data } = await post(getToken, { action: "cooked", uses });
  return res.ok ? { ok: true, items: data.items } : fail(res, data, "Couldn't update the pantry.");
}

export async function savePush(getToken, subscription) {
  const { res, data } = await post(getToken, { action: "push", subscription });
  return res.ok ? { ok: true } : fail(res, data, "Couldn't turn reminders on.");
}

export async function dropPush(getToken, endpoint) {
  await budgetFetch(getToken, `${PATH}?push=${encodeURIComponent(endpoint)}`, { method: "DELETE" });
}

/** The kitchen display's feed: no sign-in, just the household's token. */
export async function loadKitchen(token) {
  try {
    const res = await fetch(`${PATH}?kitchen=${encodeURIComponent(token)}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    return res.ok && data ? { ok: true, data } : { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
