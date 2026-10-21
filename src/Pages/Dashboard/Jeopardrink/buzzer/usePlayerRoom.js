import { useCallback, useRef, useState } from "react";
import { joinRoom, pollAsPlayer, sendBuzz, sendFinal } from "../roomApi";
import { usePolling } from "../usePolling";

/*
 * A phone's seat in a JEOPARDRINK! room: join with a name, poll the host's
 * public state, buzz, and send Last Call wagers/answers. The seat
 * (id + secret) is remembered per room code, so a refresh or a locked screen
 * drops you straight back in.
 *
 *   status: join | connecting | live | offline | gone
 */

const SEAT_KEY = (code) => `jeopardrink-seat-v1:${code}`;
const FAST = 600;
const SLOW = 1500;
const BACKOFF = 3000;
const FAST_PHASES = ["clue", "wager", "lc-wager", "lc-clue", "lc-judge"];

const loadSeat = (code) => {
  if (!code) return null;
  try {
    const seat = JSON.parse(localStorage.getItem(SEAT_KEY(code)) || "null");
    return seat && seat.playerId && seat.secret ? seat : null;
  } catch {
    return null;
  }
};
const saveSeat = (seat) => {
  try {
    localStorage.setItem(SEAT_KEY(seat.code), JSON.stringify(seat));
  } catch {
    /* private mode: a refresh means rejoining */
  }
};
const forgetSeat = (code) => {
  try {
    localStorage.removeItem(SEAT_KEY(code));
  } catch {
    /* nothing stored */
  }
};

export function usePlayerRoom(initialCode) {
  const [me, setMe] = useState(() => loadSeat(initialCode));
  const [status, setStatus] = useState(() => (loadSeat(initialCode) ? "connecting" : "join"));
  const [room, setRoom] = useState({ state: null, first: null });
  const version = useRef(null);

  const join = useCallback(async (code, name) => {
    const res = await joinRoom(code, name);
    if (!res.ok) return { ok: false, error: res.error };
    const seat = { code: res.data.code, playerId: res.data.playerId, secret: res.data.secret, name: res.data.name };
    saveSeat(seat);
    version.current = null;
    setRoom({ state: null, first: null });
    setMe(seat);
    setStatus("connecting");
    return { ok: true };
  }, []);

  const leave = useCallback(() => {
    if (me) forgetSeat(me.code);
    version.current = null;
    setMe(null);
    setRoom({ state: null, first: null });
    setStatus("join");
  }, [me]);

  const tick = async (signal) => {
    const res = await pollAsPlayer(me.code, me.playerId, version.current, signal);
    if (res.aborted) return undefined;
    if (!res.ok) {
      setStatus(res.status === 404 ? "gone" : "offline");
      return BACKOFF;
    }
    setStatus("live");
    if (res.data.unchanged) return undefined;
    version.current = res.data.version;
    setRoom({ state: res.data.state, first: res.data.first });
    return undefined;
  };

  const phase = room.state ? room.state.phase : null;
  usePolling(tick, { delay: FAST_PHASES.includes(phase) ? FAST : SLOW, enabled: Boolean(me) && status !== "gone" });

  /** Ring in on the current window. Resolves { accepted, first } or { error }. */
  const buzz = useCallback(async () => {
    const seq = room.state && room.state.buzz ? room.state.buzz.seq : null;
    if (!me || !Number.isInteger(seq)) return { accepted: false };
    const res = await sendBuzz(me, seq);
    if (!res.ok) {
      if (res.status === 404) setStatus("gone");
      return { accepted: false, error: res.error };
    }
    if (res.data.first) setRoom((r) => ({ ...r, first: res.data.first }));
    return { accepted: res.data.accepted, first: res.data.first };
  }, [me, room.state]);

  const submit = useCallback(
    async (payload) => {
      const res = await sendFinal(me, payload);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
    [me]
  );

  return { me, status, state: room.state, first: room.first, join, leave, buzz, submit };
}
