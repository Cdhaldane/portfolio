/*
 * host/board.ts — the leaderboard client.
 *
 * Lives in `host/` rather than `sim/` for the same reason `persist.ts` does: a run
 * ending is a presentation and persistence concern. The simulation's job finished when
 * it set `PHASE.lost`, and giving it a `fetch` dependency would break every headless
 * test in `tests/`.
 *
 * **Nothing here is allowed to matter.** The board is a nicety on a hidden page; the
 * game must play identically with no network, no database and no server at all. Every
 * failure — offline, 404, 503, a deploy with no `POSTGRES_URL` — resolves to "no
 * board" and is never surfaced as an error the player has to acknowledge. The API
 * answers `{ configured: false }` rather than erroring for exactly this reason.
 */

import type { Replay } from "../sim/replay.ts";
import type { Profile } from "./persist.ts";

const BASE = "/api/game";
/** Long enough for a cold serverless start, short enough not to hang the screen. */
const TIMEOUT_MS = 8000;

export interface BoardEntry {
  name: string;
  round: number;
  tally: number;
  kills: number;
  leaks: number;
  duration_ms: number;
  seed: number;
  site: number;
  created_at: string;
  /** A replay is stored, so this run can be recomputed rather than believed. */
  verifiable: boolean;
}

export interface BoardState {
  /** False when the deployment has no database. Show nothing, say nothing. */
  configured: boolean;
  entries: BoardEntry[];
}

async function ask(path: string, init?: RequestInit): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${path}`, { ...init, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Offline, aborted, blocked, malformed — all the same answer: no board.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The top runs, or an unconfigured board. Never throws. */
export async function fetchBoard(): Promise<BoardState> {
  const data = (await ask("board")) as BoardState | null;
  if (!data || !Array.isArray(data.entries)) return { configured: false, entries: [] };
  return { configured: data.configured !== false, entries: data.entries };
}

/**
 * Bank a finished run.
 *
 * Fire-and-forget by design: it is called from the frame that detects the loss, and
 * the death screen must not wait on a network round trip to appear. The return value
 * exists for tests and for the "banked" tick in the UI, not for control flow.
 */
export async function submitRun(
  profile: Profile,
  replay: Replay,
): Promise<{ ok: boolean; improved: boolean }> {
  const data = (await ask("submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      playerKey: profile.playerKey,
      name: profile.displayName,
      replay,
      website: "", // honeypot, matching guestbook/reckoning
    }),
  })) as { ok?: boolean; improved?: boolean } | null;
  return { ok: data?.ok === true, improved: data?.improved === true };
}

/**
 * Fetch one entry's replay so it can be recomputed locally.
 *
 * This is the point of storing them. `verify()` in `sim/replay.ts` replays a command
 * log against a fresh world and compares fingerprints every 600 ticks, so a visitor
 * can confirm somebody else's round in their own browser — the board makes a claim the
 * reader can check, rather than one they have to accept.
 */
export async function fetchReplay(playerKey: string): Promise<Replay | null> {
  const data = (await ask(`replay?player=${encodeURIComponent(playerKey)}`)) as
    | { replay?: Replay }
    | null;
  return data?.replay ?? null;
}
