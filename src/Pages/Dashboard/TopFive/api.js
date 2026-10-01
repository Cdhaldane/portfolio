// /api/top5 calls. Reading the saved lists is public (plain fetch). Owner
// calls reuse Budgetter's fetch wrapper, which attaches the Clerk session
// token. Nothing here throws: every failure resolves to { ok: false }.
import { budgetFetch } from "../../Budgetter/api";

const PATH = "/api/top5";

/**
 * The owner's saved pack edits, keyed by pack id. Callers must still run
 * them through buildCatalog (which validates every pack) before use.
 * Offline, no API (plain `npm start`) or a bad response → { ok: false }, and
 * the page simply keeps its shipped defaults.
 */
export async function loadOverrides(signal) {
  try {
    const res = await fetch(PATH, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    const packs = data && data.packs;
    return packs && typeof packs === "object" && !Array.isArray(packs)
      ? { ok: true, packs }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

const fail = (res, data, fallback) => ({
  ok: false,
  status: res.status,
  userId: (data && data.userId) || null,
  error: (data && data.error) || (res.status === 0 ? "You look offline. Try again." : fallback),
});

/** Is the signed-in user on the Top 5 editor allowlist? */
export async function checkEditor(getToken) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?me=1`);
  return res.ok && data && data.canEdit ? { ok: true } : fail(res, data, "Couldn't check your access.");
}

/** Save one pack. Resolves with the server-cleaned pack on success. */
export async function savePack(getToken, packId, pack) {
  const { res, data } = await budgetFetch(getToken, PATH, {
    method: "PUT",
    body: JSON.stringify({ packId, pack }),
  });
  return res.ok && data && data.pack
    ? { ok: true, pack: data.pack }
    : fail(res, data, "Couldn't save that pack.");
}

/** Drop one pack's edits so it shows the shipped defaults again. */
export async function resetPack(getToken, packId) {
  const { res, data } = await budgetFetch(getToken, `${PATH}?packId=${encodeURIComponent(packId)}`, {
    method: "DELETE",
  });
  return res.ok ? { ok: true } : fail(res, data, "Couldn't reset that pack.");
}
