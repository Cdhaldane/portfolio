import { useCallback, useState } from "react";

// Which hand each bowler throws with, so the lane picture puts their board 1
// (their own gutter) on the right side. It only mirrors pictures, so it
// lives on the phone rather than the server. Right-handed until flipped.
const KEY = "bowler-hand-v1";

function readHands() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export const handOf = (bowler, hands = readHands()) => (hands[bowler] === "L" ? "L" : "R");

/** [hand, flip] for one bowler; flipping is remembered on this phone. */
export function useHand(bowler) {
  const [hands, setHands] = useState(readHands);
  const hand = handOf(bowler, hands);
  const flip = useCallback(() => {
    const next = { ...readHands(), [bowler]: hand === "L" ? "R" : "L" };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* still flips for this visit */
    }
    setHands(next);
  }, [bowler, hand]);
  return [hand, flip];
}
