// /api/jeopardy calls for phone buzzers. Nothing here throws: every failure
// resolves to { ok: false, status, error } so a flaky bar Wi-Fi never crashes
// the game, and a host with no API (plain `npm start`) just plays without
// phones.

const PATH = "/api/jeopardy";

async function call(op, { method = "GET", query = {}, body, hostKey, signal } = {}) {
  const qs = new URLSearchParams({ op, ...query }).toString();
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (hostKey) headers["X-Host-Key"] = hostKey;
  try {
    const res = await fetch(`${PATH}?${qs}`, {
      method,
      signal,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // Non-JSON (the CRA dev server answers unknown paths with index.html).
    }
    if (res.ok && data && data.ok) return { ok: true, status: res.status, data };
    return {
      ok: false,
      status: res.status,
      error: (data && data.error) || "Couldn't reach the buzzer server.",
    };
  } catch (err) {
    if (err && err.name === "AbortError") return { ok: false, status: 0, aborted: true };
    return { ok: false, status: 0, error: "You look offline. Check your connection." };
  }
}

const since = (version) => (Number.isInteger(version) ? { v: String(version) } : {});

export const createRoom = () => call("create", { method: "POST" });

export const publishState = (room, state) =>
  call("state", { method: "PUT", hostKey: room.hostKey, body: { code: room.code, state } });

export const pollAsHost = (room, version, signal) =>
  call("poll", { query: { code: room.code, as: "host", ...since(version) }, hostKey: room.hostKey, signal });

export const pollAsPlayer = (code, playerId, version, signal) =>
  call("poll", { query: { code, ...(playerId ? { pid: playerId } : {}), ...since(version) }, signal });

export const joinRoom = (code, name) => call("join", { method: "POST", body: { code, name } });

const asPlayer = (me) => ({ code: me.code, playerId: me.playerId, secret: me.secret });

export const sendBuzz = (me, seq) => call("buzz", { method: "POST", body: { ...asPlayer(me), seq } });

export const sendFinal = (me, payload) => call("final", { method: "POST", body: { ...asPlayer(me), ...payload } });
