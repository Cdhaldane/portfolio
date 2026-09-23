// /api/bowler calls. Reuses Budgetter's never-rejecting fetch wrapper, which
// attaches the Clerk session token to every request.
import { budgetFetch } from "../Budgetter/api";

const PATH = "/api/bowler";

const fail = (res, data, fallback) => ({
  ok: false,
  error: (data && data.error) || (res.status === 0 ? "You look offline. Try again." : fallback),
});

export async function loadSeries(getToken) {
  const { res, data } = await budgetFetch(getToken, PATH);
  return res.ok ? { ok: true, series: data.series } : fail(res, data, "Couldn't load scores.");
}

export async function readPhoto(getToken, { image, mediaType }) {
  const { res, data } = await budgetFetch(getToken, PATH, {
    method: "POST",
    body: JSON.stringify({ action: "parse", image, mediaType }),
  });
  return res.ok
    ? { ok: true, read: data.read }
    : { ...fail(res, data, "Couldn't read that photo."), code: data && data.code };
}

export async function saveNight(getToken, payload) {
  const { res, data } = await budgetFetch(getToken, PATH, {
    method: "POST",
    body: JSON.stringify({ action: "save", ...payload }),
  });
  return res.ok ? { ok: true, saved: data.saved } : fail(res, data, "Couldn't save that night.");
}

export async function deleteSeries(getToken, id) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok ? { ok: true } : fail(res, data, "Couldn't delete that series.");
}
