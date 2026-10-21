import { useCallback, useEffect, useRef, useState } from "react";
import { createRoom, pollAsHost, publishState } from "./roomApi";
import { usePolling } from "./usePolling";

/*
 * The host's side of a phone-buzzer room. Opens a room when phones are
 * switched on, keeps the room's public state in step with the game (latest
 * write wins, one request in flight), and polls for joins, buzz order and
 * Last Call submissions. The game itself never waits on any of this: if the
 * network dies, the host taps names instead.
 *
 *   status: idle | creating | live | error | gone
 */

const FAST = 500; // buzzers open: a buzz should light up the host's screen fast
const MEDIUM = 900; // a clue or Last Call is in play
const SLOW = 2000; // board, lobby: just watching for joins
const BACKOFF = 3500;
const RETRY_PUBLISH = 1500;

const EMPTY = Object.freeze({ players: [], buzzes: [], seq: null, finals: {} });

const delayFor = (view) => {
  if (view.buzz && view.buzz.open) return FAST;
  if (["clue", "wager", "lc-wager", "lc-clue"].includes(view.phase)) return MEDIUM;
  return SLOW;
};

const toFinals = (rows) =>
  Object.fromEntries((rows || []).map((f) => [f.pid, { wager: f.wager, answer: f.answer }]));

export function useHostRoom({ enabled, room, onRoom, view }) {
  const [status, setStatus] = useState(room ? "live" : "idle");
  const [error, setError] = useState("");
  const [snap, setSnap] = useState(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const version = useRef(null);
  const outbox = useRef({ busy: false, pending: null, sent: null, timer: null });

  // Open a room the first time phones are switched on.
  useEffect(() => {
    if (!enabled || room) return undefined;
    let cancelled = false;
    setStatus("creating");
    setError("");
    createRoom().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        onRoom({ code: res.data.code, hostKey: res.data.hostKey });
        setStatus("live");
      } else {
        setStatus("error");
        setError(res.error || "Couldn't open a room.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, room, onRoom, attempt]);

  // A different room (or none) starts from a clean slate.
  const code = room ? room.code : null;
  useEffect(() => {
    version.current = null;
    outbox.current = { busy: false, pending: null, sent: null, timer: null };
    setSnap(EMPTY);
    if (code) setStatus("live");
  }, [code]);

  // Publish: coalesce rapid changes, one request in flight, retry on failure.
  const viewJson = JSON.stringify(view);
  const flush = useCallback(async () => {
    const box = outbox.current;
    if (!room || box.busy || box.pending === null || box.pending === box.sent) return;
    const body = box.pending;
    box.busy = true;
    box.pending = null;
    const res = await publishState(room, JSON.parse(body));
    if (outbox.current !== box) return; // the room changed mid-flight
    box.busy = false;
    if (res.ok) {
      box.sent = body;
    } else if (res.status === 404) {
      setStatus("gone");
      return;
    } else {
      if (box.pending === null) box.pending = body;
      clearTimeout(box.timer);
      box.timer = setTimeout(() => flush(), RETRY_PUBLISH);
      return;
    }
    flush();
  }, [room]);

  useEffect(() => {
    if (!room || status === "gone") return;
    outbox.current.pending = viewJson;
    flush();
  }, [viewJson, room, status, flush]);

  useEffect(() => () => clearTimeout(outbox.current.timer), []);

  const tick = async (signal) => {
    const res = await pollAsHost(room, version.current, signal);
    if (res.aborted) return undefined;
    if (!res.ok) {
      if (res.status === 404) setStatus("gone");
      return BACKOFF;
    }
    if (res.data.unchanged) return undefined;
    version.current = res.data.version;
    setSnap({
      players: res.data.players || [],
      buzzes: res.data.buzzes || [],
      seq: Number.isInteger(res.data.seq) ? res.data.seq : null,
      finals: toFinals(res.data.finals),
    });
    return undefined;
  };

  usePolling(tick, { delay: delayFor(view), enabled: Boolean(room) && status === "live" });

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, error, code, retry, ...snap };
}
