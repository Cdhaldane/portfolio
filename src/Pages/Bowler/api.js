// /api/bowler calls. Reuses Budgetter's never-rejecting fetch wrapper, which
// attaches the Clerk session token to every request.
import { budgetFetch } from "../Budgetter/api";

const PATH = "/api/bowler";

const fail = (res, data, fallback) => ({
  ok: false,
  error: (data && data.error) || (res.status === 0 ? "You look offline. Try again." : fallback),
});

/** Every saved series plus the ball bag, in one round trip. */
export async function loadSeries(getToken) {
  const { res, data } = await budgetFetch(getToken, PATH);
  return res.ok
    ? { ok: true, series: data.series, balls: data.balls || [] }
    : fail(res, data, "Couldn't load scores.");
}

export async function saveBall(getToken, ball) {
  const { res, data } = await budgetFetch(getToken, PATH, {
    method: "POST",
    body: JSON.stringify({ action: "ball", ball }),
  });
  return res.ok ? { ok: true, ball: data.ball } : fail(res, data, "Couldn't save that ball.");
}

export async function deleteBall(getToken, id) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?ballId=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return res.ok ? { ok: true } : fail(res, data, "Couldn't take that ball out of the bag.");
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
