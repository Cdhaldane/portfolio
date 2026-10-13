// /api/acta/* calls. Reading is public (plain fetch). Owner calls reuse
// Budgetter's fetch wrapper, which attaches the Clerk session token. Nothing
// here throws: every failure resolves to { ok: false }, so plain `npm start`
// (no API) falls back to the bundled sample lesson.
import { budgetFetch } from "../Budgetter/api";

const BASE = "/api/acta";

async function get(path, signal) {
  try {
    const res = await fetch(`${BASE}/${path}`, { signal, headers: { Accept: "application/json" } });
    let data = null;
    try {
      data = await res.json();
    } catch {
      return { ok: false, status: res.status, offline: true };
    }
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: data && data.error };
  } catch (e) {
    return { ok: false, status: 0, aborted: e && e.name === "AbortError", error: "You look offline." };
  }
}

async function send(path, method, body) {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON: no API here */
    }
    return res.ok ? { ok: true, data } : { ok: false, status: res.status, error: (data && data.error) || "That didn't go through. Try again." };
  } catch {
    return { ok: false, status: 0, error: "You look offline. Try again." };
  }
}

export const fetchToday = (signal) => get("today", signal);
export const fetchLesson = (slug, signal) => get(`lesson?slug=${encodeURIComponent(slug)}`, signal);
export const fetchArchive = (signal) => get("archive", signal);
export const sendFlag = (payload) => send("flag", "POST", payload);
export const fetchPushKey = () => get("push");
export const savePush = (subscription) => send("push", "POST", { subscription });
export const dropPush = (endpoint) => send("push", "DELETE", { endpoint });

// ---------------------------------------------------------------------------
// Owner (signed-in Charlie)

const fail = (res, data, fallback) => ({
  ok: false,
  status: res.status,
  userId: (data && data.userId) || null,
  error: (data && data.error) || (res.status === 0 ? "You look offline. Try again." : fallback),
});

export async function deskLoad(getToken) {
  const { res, data } = await budgetFetch(getToken, `${BASE}/desk`);
  return res.ok ? { ok: true, ...data } : fail(res, data, "Couldn't load the desk.");
}

export async function deskOp(getToken, body) {
  const { res, data } = await budgetFetch(getToken, `${BASE}/desk`, { method: "POST", body: JSON.stringify(body) });
  return res.ok ? { ok: true, ...data } : fail(res, data, "That didn't work.");
}

export async function meLoad(getToken) {
  const { res, data } = await budgetFetch(getToken, `${BASE}/me`);
  return res.ok ? { ok: true, data: data.data } : fail(res, data, "Couldn't load your reading log.");
}

export async function meSave(getToken, payload) {
  const { res, data } = await budgetFetch(getToken, `${BASE}/me`, { method: "PUT", body: JSON.stringify({ data: payload }) });
  return res.ok ? { ok: true } : fail(res, data, "Couldn't save your reading log.");
}

/** Every scheduled lesson, out yet or not (Charlie's archive). */
export async function ownerArchive(getToken) {
  const { res, data } = await budgetFetch(getToken, `${BASE}/all-lessons`);
  return res.ok && data ? { ok: true, lessons: data.lessons || [], date: data.date } : fail(res, data, "Couldn't load every lesson.");
}

/** One lesson before its day (or while held back). */
export async function ownerLesson(getToken, slug) {
  const { res, data } = await budgetFetch(getToken, `${BASE}/any-lesson?slug=${encodeURIComponent(slug)}`);
  return res.ok && data && data.lesson ? { ok: true, lesson: data.lesson, date: data.date } : fail(res, data, "Couldn't open that lesson.");
}

export async function askQuestion(getToken, payload) {
  const { res, data } = await budgetFetch(getToken, `${BASE}/ask`, { method: "POST", body: JSON.stringify(payload) });
  return res.ok ? { ok: true, answer: data.answer } : fail(res, data, "Couldn't get an answer.");
}
