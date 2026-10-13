import { useCallback, useEffect, useMemo, useRef } from "react";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { meLoad, meSave } from "./api";
import { getState, mergeState, replaceState, subscribe } from "./store";

/*
 * Owner mode, lazy-loaded only on Charlie's own devices (and on the desk), so
 * visitors never download Clerk. It provides a token getter for Ask and the
 * desk, and mirrors the local reading state (progress, deck, saves) to
 * /api/acta/me: on sign-in it merges the server copy into this device's,
 * then saves changes a few seconds after they happen.
 *
 * Provider options match the other gated pages (Clerk keeps the first
 * provider's options for the whole tab).
 */
const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;
const SAVE_AFTER_MS = 4000;

const APPEARANCE = {
  variables: {
    colorPrimary: "#d9773d",
    colorText: "#f2e4cf",
    colorTextSecondary: "#bba68c",
    colorBackground: "#231913",
    colorInputBackground: "#15100d",
    colorInputText: "#f2e4cf",
    borderRadius: "12px",
    fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
  },
};

function useSync(owner) {
  useEffect(() => {
    if (!owner.signedIn) return undefined;
    let live = true;
    let enabled = false;
    let timer = 0;
    (async () => {
      const r = await meLoad(owner.getToken);
      // 403 = signed in but not Charlie: stay local-only.
      if (!live || !r.ok) return;
      enabled = true;
      replaceState(mergeState(getState(), r.data || {}));
      await meSave(owner.getToken, getState());
    })();
    const unsub = subscribe(() => {
      if (!enabled) return;
      clearTimeout(timer);
      timer = setTimeout(() => meSave(owner.getToken, getState()), SAVE_AFTER_MS);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      unsub();
    };
  }, [owner.signedIn, owner.getToken]);
}

function Bridge({ children }) {
  const { isLoaded, isSignedIn, getToken, signOut, userId } = useAuth();
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const stableGetToken = useCallback(() => tokenRef.current(), []);
  const owner = useMemo(
    () => ({ loaded: isLoaded, signedIn: Boolean(isSignedIn), userId: userId || null, getToken: stableGetToken, signOut }),
    [isLoaded, isSignedIn, userId, stableGetToken, signOut]
  );
  useSync(owner);
  return children(owner);
}

export default function OwnerRoot({ children }) {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/acta" appearance={APPEARANCE}>
      <Bridge>{children}</Bridge>
    </ClerkProvider>
  );
}
