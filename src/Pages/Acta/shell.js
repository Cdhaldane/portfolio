// Shared context for the Acta surface: the current era skin and, on Charlie's
// own devices, the signed-in owner (token getter for Ask, sync and the desk).
import { createContext, useContext, useEffect, useState } from "react";
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

/**
 * Whether we know yet if Charlie is signed in. On an owner device the Clerk
 * chunk and session take a moment, and owner-only views (the full archive,
 * early lessons) should wait rather than flash the public version first. Gives
 * up after a few seconds so a Clerk that never loads can't hang the page.
 */
export function useOwnerSettled(owner) {
  const pending = owner ? !owner.loaded : Boolean(process.env.REACT_APP_CLERK_PUBLISHABLE_KEY) && isOwnerDevice();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!pending) return undefined;
    const t = setTimeout(() => setGaveUp(true), 4000);
    return () => clearTimeout(t);
  }, [pending]);
  return !pending || gaveUp;
}
