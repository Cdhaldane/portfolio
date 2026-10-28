// Frame-level stats for /bowler: strikes, spares by leave, splits, open
// frames, first-ball average, pocket hits and the leaves you see most.
// Input is the API's series list, where each row may carry
//   frames: [Frame[] | null, Frame[] | null, Frame[] | null]
// Only games with frames feed these numbers (score-only games can't), so
// every result reports how many games it stands on. Nothing mutates input.
import { PINS, isSplit, playFrame } from "./scoring";
import { seriesFor } from "./stats";

const round1 = (n) => Math.round(n * 10) / 10;

/** { made, chances, pct } with pct null when there were no chances. */
const rate = ({ made, chances }) => ({
  made,
  chances,
  pct: chances ? round1((made / chances) * 100) : null,
});

const counter = () => ({ made: 0, chances: 0 });
const bump = (c, made) => {
  c.chances += 1;
  if (made) c.made += 1;
};

export const framesOf = (row) =>
  Array.isArray(row.frames) ? row.frames : [null, null, null];

export const framedGames = (row) => framesOf(row).filter(Boolean);

export const leaveKey = (pins) => pins.join("-");

// A frame with no strike or spare. In the 10th that's decided by the first
// two balls; a strike followed by 7-2 isn't open.
const isOpen = (frame) => frame.rolls[0] !== PINS && frame.rolls[0] + frame.rolls[1] < PINS;

function tally(games) {
  const t = {
    games: games.length,
    fullRack: 0,
    firstPins: 0,
    opens: 0,
    strike: counter(),
    spare: counter(),
    single: counter(),
    multi: counter(),
    split: counter(),
    pocket: counter(),
    leaves: new Map(),
  };

  games.forEach((frames) =>
    frames.forEach((frame, i) => {
      if (isOpen(frame)) t.opens += 1;
      if (typeof frame.pocket === "boolean") bump(t.pocket, frame.pocket);

      const { shots } = playFrame(frame, i);
      shots.forEach((shot, k) => {
        // Every ball at a full rack is a strike chance, the 10th's fill
        // balls included (twelve in a perfect game).
        if (!shot.rack.fresh) return;
        t.fullRack += 1;
        t.firstPins += shot.down;
        bump(t.strike, shot.down === PINS);
        if (shot.down === PINS) return;

        // The next ball in the frame is the spare attempt. A 10th-frame
        // fill ball after a spare has none, so it's not a spare chance.
        const attempt = shots[k + 1];
        if (!attempt) return;
        const made = attempt.left.count === 0;
        bump(t.spare, made);

        const pins = shot.left.pins;
        if (shot.left.count === 1) bump(t.single, made);
        else if (pins) bump(isSplit(pins) ? t.split : t.multi, made);
        // Count-only frames can't tell a split from a bucket, so they sit
        // out the multi/split buckets (they still count toward spares).

        if (pins) {
          const key = leaveKey(pins);
          const leave = t.leaves.get(key) || { key, pins, ...counter(), split: isSplit(pins) };
          bump(leave, made);
          t.leaves.set(key, leave);
        }
      });
    })
  );
  return t;
}

function summarize(t, topLeaves) {
  return {
    games: t.games,
    strike: rate(t.strike),
    spare: rate(t.spare),
    single: rate(t.single),
    multi: rate(t.multi),
    split: rate(t.split),
    pocket: rate(t.pocket),
    opensPerGame: t.games ? round1(t.opens / t.games) : null,
    firstBall: t.fullRack ? round1(t.firstPins / t.fullRack) : null,
    // Most-seen first, then the one you convert least (the one to practise).
    leaves: [...t.leaves.values()]
      .map((l) => ({ ...rate(l), key: l.key, pins: l.pins, split: l.split }))
      .sort((a, b) => b.chances - a.chances || a.pct - b.pct || a.key.localeCompare(b.key))
      .slice(0, topLeaves),
  };
}

/** One bowler's frame stats over a series list (scope it to a season first). */
export function frameStats(series, bowler, { topLeaves = 6 } = {}) {
  const rows = seriesFor(series, bowler);
  const stats = summarize(tally(rows.flatMap(framedGames)), topLeaves);
  return { ...stats, totalGames: rows.reduce((n, r) => n + r.games.length, 0) };
}

/** Frame stats for one bowler's night (one series row). */
export function nightFrameStats(row, { topLeaves = 3 } = {}) {
  return { ...summarize(tally(framedGames(row)), topLeaves), totalGames: row.games.length };
}
