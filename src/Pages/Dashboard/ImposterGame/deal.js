/*
 * Round dealing for Word Imposter. Pure — every random draw goes through
 * `rng` — so it can be tested without React or a real Math.random.
 */

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;
/* Chance a round (when chaos is on) makes the whole crew the imposter. */
export const CHAOS_CHANCE = 0.06;
/* How many played words stay out of rotation. */
export const RECENT_LIMIT = 600;

/* Keep the imposters a minority: 3–4 agents → 1, 5–6 → 2, 7+ → 3. */
export const maxImposters = (n) => Math.min(3, Math.max(1, Math.floor((n - 1) / 2)));

export const wordKey = (catId, word) => `${catId}:${word}`;
const wordOf = (key) => key.slice(key.indexOf(":") + 1).toLowerCase();

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

const shuffle = (arr, rng) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/**
 * A category first, then a word from it, so a small category is as likely as
 * a big one and a mixed deck stays mixed. Recently played words are skipped —
 * by the word itself, since a few (Moose, Drake) live in two categories —
 * and once every selected word has been played the rotation starts over.
 */
export function pickWord(cats, recent, rng = Math.random) {
  const played = new Set(recent.map(wordOf));
  const fresh = cats
    .map((cat) => ({ cat, words: cat.words.filter(([w]) => !played.has(w.toLowerCase())) }))
    .filter((c) => c.words.length > 0);
  const exhausted = fresh.length === 0;
  const pool = exhausted ? cats.map((cat) => ({ cat, words: cat.words })) : fresh;

  const { cat, words } = pick(pool, rng);
  const [word, ...hints] = pick(words, rng);
  return { cat, word, hints, exhausted };
}

/**
 * Deals one round. Returns the round plus the updated recent-words list for
 * the caller to persist.
 */
export function dealRound(
  { roster, cats, imposterCount = 1, chaos = true, recent = [], lastStarter = null },
  rng = Math.random
) {
  const n = roster.length;
  const seats = roster.map((_, i) => i);

  const allImposter = chaos && rng() < CHAOS_CHANCE;
  const count = allImposter ? n : Math.min(Math.max(1, imposterCount), maxImposters(n));
  const imposters = shuffle(seats, rng).slice(0, count).sort((a, b) => a - b);

  const { cat, word, hints, exhausted } = pickWord(cats, recent, rng);

  // Every imposter gets their own hint, cycling once there are more of them
  // than hints — so a chaos round has the crew bluffing from different angles.
  const dealt = shuffle(hints, rng);
  const hintFor = {};
  imposters.forEach((seat, k) => {
    hintFor[seat] = dealt[k % dealt.length];
  });

  // Anyone can open, just not the same agent twice running.
  const openers = n > 1 ? seats.filter((i) => roster[i] !== lastStarter) : seats;
  const starter = pick(openers.length ? openers : seats, rng);
  const order = seats.map((k) => (starter + k) % n);

  const ownCats = (key) => cats.some((c) => key.startsWith(`${c.id}:`));
  const kept = exhausted ? recent.filter((key) => !ownCats(key)) : recent;
  const nextRecent = [...kept, wordKey(cat.id, word)].slice(-RECENT_LIMIT);

  return {
    round: {
      roster,
      category: { id: cat.id, name: cat.name, icon: cat.icon },
      word,
      hints,
      imposters,
      hintFor,
      allImposter,
      starter,
      order,
    },
    recent: nextRecent,
  };
}
