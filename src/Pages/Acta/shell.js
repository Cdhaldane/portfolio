// Shared context for the Acta surface: the current era skin and, on Charlie's
// own devices, the signed-in owner (token getter for Ask, sync and the desk).
import { createContext, useContext } from "react";
import SAMPLE from "./lessons/salamis.json";

export const ShellContext = createContext({ era: "greece", setEra: () => {}, owner: null });
export const useShell = () => useContext(ShellContext);

/** The bundled lesson, shown before any lesson is live (and when offline in dev). */
export const SAMPLE_LESSON = {
  ...SAMPLE,
  next: { slug: SAMPLE.teaserFor, title: "Ostracism", kind: "idea", date: null },
};

const OWNER_KEY = "acta:owner";

/** Charlie's devices load Clerk (for Ask and sync); visitors never download it. */
export function isOwnerDevice() {
  try {
    return window.localStorage.getItem(OWNER_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOwnerDevice(on) {
  try {
    if (on) window.localStorage.setItem(OWNER_KEY, "1");
    else window.localStorage.removeItem(OWNER_KEY);
  } catch {
    /* storage blocked: owner mode just won't stick */
  }
}
