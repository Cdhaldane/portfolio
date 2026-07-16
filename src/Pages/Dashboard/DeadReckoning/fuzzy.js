// Forgiving name matching for DEAD // RECKONING. A guess counts if it's a
// close-enough Levenshtein match against the person's full name, any explicit
// alias, their last name, or their last two names ("van gogh", "conan doyle").
// "Close enough" scales with length so typos never sink a correct answer.

// Lowercase, strip diacritics ("Dalí" -> "dali"), drop everything that isn't
// a letter/number, collapse whitespace.
export function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// How many edits a string of this length may be off by and still count.
const tolerance = (len) => (len <= 4 ? 1 : len <= 8 ? 2 : 3);

function closeEnough(guess, target) {
  if (!target) return false;
  // Compare de-spaced too, so "jrr tolkien" == "j r r tolkien".
  const g = guess.replace(/ /g, "");
  const t = target.replace(/ /g, "");
  if (g === t) return true;
  if (t.length < 3) return g === t; // don't fuzz tiny targets
  return levenshtein(g, t) <= tolerance(t.length);
}

// All the strings a guess may be checked against for a given person.
export function candidatesFor(person) {
  const out = new Set();
  const full = normalize(person.name);
  out.add(full);
  const words = full.split(" ").filter(Boolean);
  if (words.length > 1) {
    const last = words[words.length - 1];
    if (last.length >= 3) out.add(last);
    if (words.length >= 3) out.add(words.slice(-2).join(" "));
  }
  (person.alt || []).forEach((a) => out.add(normalize(a)));
  return [...out];
}

// Leading articles/titles people naturally type but the data may omit.
const STRIP_PREFIX = /^(the|sir|dr|mr|mrs|ms|saint|st|queen|king|president|pope|lord|lady) /;

export function isCorrectGuess(rawGuess, person) {
  const guess = normalize(rawGuess);
  if (!guess) return false;
  const stripped = guess.replace(STRIP_PREFIX, "");
  const candidates = candidatesFor(person);
  return candidates.some(
    (c) =>
      closeEnough(guess, c) ||
      (stripped !== guess && closeEnough(stripped, c)) ||
      // symmetric: data says "Queen Victoria", player types "victoria"
      closeEnough(guess, c.replace(STRIP_PREFIX, ""))
  );
}
