import { angleFor, faceFor, revealsFace } from "./parts/CardHand";
import { PHASE } from "./deckReducer";

test("a face-down card at 180 reaches its front at 360, not 0", () => {
  // Math.round(0.5) is 1: the trap that hid the legendary payoff.
  expect(angleFor("front", 180)).toBe(360);
  expect(angleFor("back", 0)).toBe(180);
  expect(angleFor("front", 0)).toBe(0);
  expect(angleFor("back", 360)).toBe(540);
});

test("the reveal fires on the frame the front comes into view, whichever way it spins", () => {
  expect(revealsFace(180, 300)).toBe(true); // 180 -> 360 passes edge-on at 270
  expect(revealsFace(180, 0)).toBe(true); // 180 -> 0 passes at 90
  expect(revealsFace(180, 360)).toBe(true); // an instant jump
  expect(revealsFace(200, 260)).toBe(false); // still showing the back
  expect(revealsFace(0, 120)).toBe(false); // front to back is not a reveal
});

test("faces follow the beat", () => {
  const beat = (phase, extra = {}) => ({ phase, revealed: false, inspected: null, backShown: false, ...extra });
  expect(faceFor(0, beat(PHASE.RIPPING))).toBe("back");
  expect(faceFor(0, beat(PHASE.DEALING))).toBe("front");
  expect(faceFor(4, beat(PHASE.LEGEND))).toBe("back");
  expect(faceFor(4, beat(PHASE.REVEAL, { revealed: true }))).toBe("front");
  expect(faceFor(2, beat(PHASE.INSPECT, { revealed: true, inspected: 2, backShown: true }))).toBe("back");
});
