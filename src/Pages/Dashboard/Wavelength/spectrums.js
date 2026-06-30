// Spectrum deck for the "Wavelength" party game. Each entry is a pair of
// opposing concepts; the psychic gets a hidden target somewhere along the line
// between them and gives a one-word clue to pull the team's dial toward it.

export const SPECTRUMS = [
  { left: "Cold", right: "Hot" },
  { left: "Underrated", right: "Overrated" },
  { left: "Forgettable", right: "Iconic" },
  { left: "Useless superpower", right: "Useful superpower" },
  { left: "Bad habit", right: "Good habit" },
  { left: "Fantasy", right: "Sci-fi" },
  { left: "Round", right: "Pointy" },
  { left: "Hard to do", right: "Easy to do" },
  { left: "Common", right: "Rare" },
  { left: "Forbidden", right: "Encouraged" },
  { left: "Stops the party", right: "Starts the party" },
  { left: "Guilty pleasure", right: "Refined taste" },
  { left: "A want", right: "A need" },
  { left: "Temporary", right: "Permanent" },
  { left: "Casual", right: "Formal" },
  { left: "Cheap", right: "Expensive" },
  { left: "Weird", right: "Normal" },
  { left: "Quiet", right: "Loud" },
  { left: "Mainstream", right: "Niche" },
  { left: "Old-fashioned", right: "Modern" },
  { left: "A villain", right: "A hero" },
  { left: "Ugly", right: "Beautiful" },
  { left: "Boring", right: "Exciting" },
  { left: "Fragile", right: "Tough" },
  { left: "Useless invention", right: "Life-changing invention" },
  { left: "Underdog", right: "Favorite" },
  { left: "Childish", right: "Mature" },
  { left: "A fad", right: "A classic" },
  { left: "Dangerous", right: "Safe" },
  { left: "Selfish", right: "Selfless" },
  { left: "Disgusting food", right: "Delicious food" },
  { left: "Lazy", right: "Hardworking" },
  { left: "Introvert activity", right: "Extrovert activity" },
  { left: "Worst superpower", right: "Best superpower" },
  { left: "Overthinking", right: "Going with your gut" },
  { left: "A chore", right: "A treat" },
  { left: "Unhealthy", right: "Healthy" },
  { left: "Bad gift", right: "Great gift" },
  { left: "Dystopia", right: "Utopia" },
  { left: "A risk", right: "A sure thing" },
  { left: "Tacky", right: "Classy" },
  { left: "Forgivable", right: "Unforgivable" },
  { left: "Overpriced", right: "A bargain" },
  { left: "A flop", right: "A masterpiece" },
  { left: "Soft", right: "Hard" },
  { left: "Slow", right: "Fast" },
  { left: "Wholesome", right: "Cursed" },
  { left: "A red flag", right: "A green flag" },
  { left: "Smells bad", right: "Smells good" },
  { left: "A scam", right: "Worth every penny" },
  { left: "Best at parties", right: "Best alone" },
  { left: "Embarrassing", right: "Impressive" },
  { left: "Junk food", right: "Health food" },
  { left: "A waste of time", right: "Time well spent" },
  { left: "Low energy", right: "High energy" },
  { left: "A pet peeve", right: "Totally fine" },
  { left: "Antisocial", right: "Social" },
  { left: "Trashy TV", right: "Prestige TV" },
  { left: "A want to skip", right: "Can't miss" },
  { left: "Spicy", right: "Mild" },
  { left: "Hard to pronounce", right: "Easy to pronounce" },
  { left: "A bad idea", right: "A genius idea" },
  { left: "Should be illegal", right: "Should be mandatory" },
  { left: "Aged badly", right: "Aged well" },
  { left: "A burden", right: "A gift" },
  { left: "Messy", right: "Tidy" },
  { left: "Overdressed", right: "Underdressed" },
  { left: "Too early", right: "Too late" },
  { left: "A whisper", right: "A shout" },
  { left: "Basic", right: "Extra" },
  { left: "Forget it", right: "Never forget it" },
];

// Fisher–Yates shuffle, returning a new array (no mutation of the source).
export const shuffle = (arr) => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// A "bag" that deals spectrums without repeats until the deck is exhausted,
// then reshuffles. Returns { item, bag } so callers stay immutable.
export const drawSpectrum = (bag) => {
  const next = bag.length ? bag : shuffle(SPECTRUMS);
  const [item, ...rest] = next;
  return { item, bag: rest };
};

// Random target along the line, kept away from the extreme edges so a clue is
// always possible on both sides. Returned in value-space [0, 1].
const TARGET_MARGIN = 0.08;
export const randomTarget = () =>
  TARGET_MARGIN + Math.random() * (1 - 2 * TARGET_MARGIN);

// Scoring bands as half-widths in value-space, richest first.
export const BANDS = [
  { half: 0.035, score: 4 },
  { half: 0.09, score: 3 },
  { half: 0.15, score: 2 },
];

// Score a guess against the target: distance falls into the tightest band.
export const scoreGuess = (guess, target) => {
  const d = Math.abs(guess - target);
  for (const band of BANDS) {
    if (d <= band.half) return band.score;
  }
  return 0;
};
