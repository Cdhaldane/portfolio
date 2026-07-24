// Tiny fetch wrapper for /api/budget/* — attaches the Clerk session token so
// no call site can forget the Authorization header.
//
// Never rejects: a thrown getToken()/fetch() (offline, dev API not running)
// resolves to { res: { ok: false, status: 0 }, data: null, offline: true }
// so callers' busy/loading flags always unwind through their normal
// failure branches instead of wedging on an unhandled rejection.
export async function budgetFetch(getToken, path, options = {}) {
  try {
    const token = await getToken();
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON (e.g. CRA dev server serving index.html when the API isn't
      // running) — callers check res.ok before trusting data.
    }
    return { res, data };
  } catch {
    return { res: { ok: false, status: 0 }, data: null, offline: true };
  }
}
