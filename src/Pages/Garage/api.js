// /api/telemetry calls. Reuses Budgetter's never-rejecting fetch wrapper, which
// attaches the Clerk session token to every request.
import { budgetFetch } from "../Budgetter/api";

const PATH = "/api/telemetry";

const fail = (res, data, fallback) => ({
  ok: false,
  error: (data && data.error) || (res.status === 0 ? "You look offline. Try again." : fallback),
});

const post = (getToken, body) =>
  budgetFetch(getToken, PATH, { method: "POST", body: JSON.stringify(body) });

/** Every log (no raw CSV) and the whole work log, in one round trip. */
export async function loadGarage(getToken) {
  const { res, data } = await budgetFetch(getToken, PATH);
  return res.ok
    ? { ok: true, logs: data.logs, events: data.events, stale: data.stale || 0 }
    : fail(res, data, "Couldn't load the garage.");
}

/** One log with its summary and channels, plus series for `cols`. */
export async function loadLog(getToken, id, { cols = [], t0 = null, t1 = null, points } = {}) {
  const q = new URLSearchParams({ id: String(id) });
  if (cols.length) q.set("cols", cols.join(","));
  if (t0 !== null) q.set("t0", String(t0));
  if (t1 !== null) q.set("t1", String(t1));
  if (points) q.set("points", String(points));
  const { res, data } = await budgetFetch(getToken, `${PATH}?${q}`);
  return res.ok
    ? { ok: true, log: data.log, channels: data.channels, series: data.series, checks: data.checks }
    : fail(res, data, "Couldn't open that log.");
}

/** Dry run (commit false) or save (commit true) one gzipped CSV. */
export async function uploadLog(getToken, payload) {
  const { res, data } = await post(getToken, { action: "upload", ...payload });
  if (res.ok) return { ok: true, preview: data.preview, duplicateOf: data.duplicateOf, log: data.log };
  return { ...fail(res, data, "Couldn't upload that log."), duplicateOf: data && data.duplicateOf };
}

export async function editLog(getToken, changes) {
  const { res, data } = await post(getToken, { action: "edit", ...changes });
  return res.ok ? { ok: true, log: data.log } : fail(res, data, "Couldn't save that change.");
}

export async function deleteLog(getToken, id) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok ? { ok: true } : fail(res, data, "Couldn't delete that log.");
}

export async function reanalyze(getToken, afterId) {
  const { res, data } = await post(getToken, { action: "reanalyze", afterId });
  return res.ok
    ? { ok: true, updated: data.updated, failed: data.failed, remaining: data.remaining, lastId: data.lastId }
    : fail(res, data, "Couldn't re-analyse the logs.");
}

export async function saveEvent(getToken, event) {
  const { res, data } = await post(getToken, { action: "event", event });
  return res.ok ? { ok: true, event: data.event } : fail(res, data, "Couldn't save that entry.");
}

export async function deleteEvent(getToken, id) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?eventId=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok ? { ok: true } : fail(res, data, "Couldn't delete that entry.");
}
