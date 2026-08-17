/*
 * host/persist.ts — the profile, stored locally.
 *
 * The whole design rests on "the highest round you reached is the score" (§4), and
 * until now that number evaporated on refresh. This keeps it.
 *
 * Local-first, exactly as §18.3 specifies: `localStorage` is the source of truth
 * and the server is a mirror, so the game is fully playable with the API down or
 * absent — which right now it is. The `player_key` minted here is the same one the
 * leaderboard will submit under later, so nothing has to be migrated when the
 * server lands.
 *
 * The merge/sort/cap logic is exported as pure functions so it can be tested in
 * plain Node without a browser (§19.1).
 */

import type { ReplayOutcome } from "../sim/replay.ts";

const KEY = "gh-profile-v1";
export const MAX_RUNS = 20;

export interface RunRecord {
  round: number;
  tally: number;
  /** Ash this run paid out (§10). Stored so the ledger can be re-read. */
  ash: number;
  kills: number;
  leaks: number;
  durationMs: number;
  seed: number;
  at: string;
}

export interface Profile {
  /** Client-generated, no accounts, no PII (§18.3). */
  playerKey: string;
  displayName: string;
  bestRound: number;
  bestTally: number;
  runsPlayed: number;
  /** Unspent Ash — the meta currency (§10). */
  ash: number;
  /** Total ever earned, so the Coffin can show progress that spending can't undo. */
  ashLifetime: number;
  /** Most recent first, capped. */
  runs: RunRecord[];
}

/**
 * Ash paid for a finished run (§10, decision 20).
 *
 * `floor(tally / 1000) × (1 + highestRound / 20)`.
 *
 * Both terms are load-bearing and neither is sufficient: Tally alone would pay a
 * short flashy run, highest round alone would pay turtling. The product only
 * rewards surviving deep *while* killing well — and since Tally is dominated by
 * combo hands (§5), the fast route to a weapon runs through kill boxes rather
 * than through playing more.
 *
 * Deliberately steep. A round-22 run scoring 46,000 pays ~96, against weapon
 * prices of 400–900.
 */
export function ashForRun(tally: number, highestRound: number): number {
  if (tally <= 0 || highestRound <= 0) return 0;
  return Math.floor(Math.floor(tally / 1000) * (1 + highestRound / 20));
}

export function emptyProfile(playerKey: string): Profile {
  return {
    playerKey,
    displayName: "",
    bestRound: 0,
    bestTally: 0,
    runsPlayed: 0,
    ash: 0,
    ashLifetime: 0,
    runs: [],
  };
}

/**
 * Fold a finished run into a profile. Pure: takes a profile, returns a new one.
 *
 * Returns `bestRound`/`bestTally` flags so the death screen can say "new best"
 * without recomputing the comparison and risking disagreeing with what was stored.
 */
export function recordRun(
  profile: Profile,
  outcome: ReplayOutcome,
  seed: number,
): {
  profile: Profile;
  newBestRound: boolean;
  newBestTally: boolean;
  ashEarned: number;
} {
  const newBestRound = outcome.round > profile.bestRound;
  const newBestTally = outcome.tally > profile.bestTally;
  const ashEarned = ashForRun(outcome.tally, outcome.round);

  const run: RunRecord = {
    round: outcome.round,
    tally: outcome.tally,
    ash: ashEarned,
    kills: outcome.kills,
    leaks: outcome.leaks,
    durationMs: outcome.durationMs,
    seed,
    at: outcome.durationMs >= 0 ? new Date().toISOString() : "",
  };

  return {
    profile: {
      ...profile,
      bestRound: Math.max(profile.bestRound, outcome.round),
      bestTally: Math.max(profile.bestTally, outcome.tally),
      runsPlayed: profile.runsPlayed + 1,
      ash: profile.ash + ashEarned,
      ashLifetime: profile.ashLifetime + ashEarned,
      runs: [run, ...profile.runs].slice(0, MAX_RUNS),
    },
    newBestRound,
    newBestTally,
    ashEarned,
  };
}

/** Repair anything missing, so a partially-written or older blob still loads. */
export function normalize(raw: unknown, fallbackKey: string): Profile {
  const base = emptyProfile(fallbackKey);
  if (typeof raw !== "object" || raw === null) return base;
  const p = raw as Partial<Profile>;
  return {
    playerKey: typeof p.playerKey === "string" && p.playerKey ? p.playerKey : fallbackKey,
    displayName: typeof p.displayName === "string" ? p.displayName : "",
    bestRound: Number.isFinite(p.bestRound) ? Number(p.bestRound) : 0,
    bestTally: Number.isFinite(p.bestTally) ? Number(p.bestTally) : 0,
    runsPlayed: Number.isFinite(p.runsPlayed) ? Number(p.runsPlayed) : 0,
    /* Profiles saved before Ash existed have neither field. They load with zero
     * rather than NaN, which is the whole reason this function is here. */
    ash: Number.isFinite(p.ash) ? Number(p.ash) : 0,
    ashLifetime: Number.isFinite(p.ashLifetime) ? Number(p.ashLifetime) : 0,
    runs: Array.isArray(p.runs)
      ? p.runs
          .filter((r): r is RunRecord => typeof r === "object" && r !== null)
          .slice(0, MAX_RUNS)
      : [],
  };
}

// ── browser side ───────────────────────────────────────────────────────────

function newKey(): string {
  // crypto.randomUUID is not universally available over plain http on older
  // browsers, so fall back to something good enough for a local id.
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `gh-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function loadProfile(): Profile {
  const fallback = newKey();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProfile(fallback);
    return normalize(JSON.parse(raw), fallback);
  } catch {
    return emptyProfile(fallback);
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private browsing or a full quota. Losing a personal best is not worth
    // taking the game down for.
  }
}
