// Chart geometry shared by the Budgetter SVG charts. Kept separate from
// format.js (which is money/date text) because these are pure drawing maths —
// and because two surfaces drawing bars from two copies of `topRoundedBar`
// would eventually drift apart, which is exactly how a design system rots.

/** Round a max up to a clean axis top: 1, 2, 2.5, 5 or 10 x a power of ten. */
export const niceMax = (v) => {
  if (v <= 0) return 100;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * exp >= v) return m * exp;
  }
  return 10 * exp;
};

/**
 * Bar path with a 4px rounded data-end and a square baseline end (the house
 * mark spec). Radius shrinks for short/thin bars so a 3px sliver still reads
 * as a rectangle instead of a lozenge.
 */
export const topRoundedBar = (x, y, w, h) => {
  const r = Math.min(4, h, w / 2);
  const yb = y + h;
  return `M ${x} ${yb} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${yb} Z`;
};

/** Same shape rotated: rounded RIGHT end, square left, for horizontal bars. */
export const endRoundedBar = (x, y, w, h) => {
  const r = Math.min(4, w, h / 2);
  return `M ${x} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} L ${x} ${y + h} Z`;
};
