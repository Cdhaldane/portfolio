import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClerkFailed,
  ClerkLoading,
  ClerkProvider,
  SignIn,
  SignedIn,
  SignedOut,
  useAuth,
} from "@clerk/clerk-react";
import BackOffice from "./BackOffice";
import { checkEditor } from "../api";

/*
 * The STAFF ONLY door. Lazy-loaded (with Clerk) only when someone opens it,
 * so regular visitors never download the auth SDK. The API re-verifies the
 * Clerk session and the TOP5_EDITOR_USER_IDS allowlist on every call; this
 * component only decides what to show.
 *
 * Provider options match BudgetGate/BowlerGate (Clerk keeps the first
 * provider's options for the whole tab), and the theme rides on <SignIn>
 * itself so it can't leak into those pages.
 */
const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;
const HOME = "/dashboard/top5";
const APPEARANCE = {
  variables: {
    colorPrimary: "#ffd36b",
    colorText: "#f4efe3",
    colorTextSecondary: "#9aa0b8",
    colorBackground: "#141a38",
    colorInputBackground: "#10143a",
    colorInputText: "#f4efe3",
    borderRadius: "12px",
    fontFamily: '"Space Grotesk", system-ui, sans-serif',
  },
};

const focusables = (root) =>
  root
    ? [...root.querySelectorAll("button:not([disabled]), [href], input, textarea, select, [tabindex]")].filter(
        (el) => el.tabIndex >= 0
      )
    : [];

function Gate({ catalog, listsState, onRetryLists, onSaved, onDirty }) {
  const { getToken, signOut, userId } = useAuth();
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;
  const stableGetToken = useCallback(() => tokenRef.current(), []);
  const [access, setAccess] = useState({ state: "checking" });

  useEffect(() => {
    let live = true;
    setAccess({ state: "checking" });
    checkEditor(stableGetToken).then((r) => {
      if (!live) return;
      if (r.ok) setAccess({ state: "ok" });
      else setAccess({ state: r.status === 403 ? "denied" : "error", error: r.error, userId: r.userId });
    });
    return () => {
      live = false;
    };
  }, [userId, stableGetToken]);

  const signOutHere = () => signOut({ redirectUrl: HOME });

  if (access.state === "checking") return <p className="td-staff-note">Checking your staff badge…</p>;
  if (access.state === "denied") {
    return (
      <div className="td-staff-note">
        <p>
          <b>Staff only.</b> This shelf is Charlie's.
        </p>
        {access.userId ? (
          <p className="td-staff-id">
            Signed in as <code>{access.userId}</code>. If that's you, Charlie, add it to{" "}
            <code>TOP5_EDITOR_USER_IDS</code>.
          </p>
        ) : null}
        <button type="button" className="td-tbtn" onClick={signOutHere}>
          <span>Sign out</span>
        </button>
      </div>
    );
  }
  if (access.state === "error") return <p className="td-staff-note">{access.error}</p>;

  // Never edit on top of the shipped defaults: if the saved lists haven't
  // loaded, a save would overwrite them.
  if (listsState === "loading") return <p className="td-staff-note">Loading your saved lists…</p>;
  if (listsState === "failed") {
    return (
      <div className="td-staff-note">
        <p>Couldn't load your saved lists, so editing is paused (saving now could overwrite them).</p>
        <button type="button" className="td-tbtn" onClick={onRetryLists}>
          <span>Try again</span>
        </button>
      </div>
    );
  }
  return (
    <>
      <BackOffice catalog={catalog} getToken={stableGetToken} onSaved={onSaved} onDirty={onDirty} />
      <div className="td-staff-signout">
        <button type="button" className="td-tbtn td-tbtn--ghost" onClick={signOutHere}>
          <i className="fa-solid fa-right-from-bracket" aria-hidden="true" />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );
}

export default function StaffEditor({ catalog, listsState, onRetryLists, onSaved, onClose }) {
  const rootRef = useRef(null);
  const closeRef = useRef(null);
  const [confirmClose, setConfirmClose] = useState(false);
  // A ref, not state: only the close guard reads it, and it must be current
  // the instant a save lands (BackOffice writes it from a layout effect).
  // New edits re-arm the guard so every later close asks again.
  const dirtyRef = useRef(false);
  const setDirty = useCallback((value) => {
    dirtyRef.current = value;
    setConfirmClose(false);
  }, []);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const requestClose = () => {
    if (dirtyRef.current && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const els = focusables(rootRef.current);
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div className="td-staff" role="dialog" aria-modal="true" aria-labelledby="td-staff-h" ref={rootRef} onKeyDown={onKeyDown}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="td-staff-backdrop" onClick={requestClose} />
      <section className="td-staff-panel">
        <header className="td-staff-head">
          <h2 id="td-staff-h">
            <i className="fa-solid fa-key" aria-hidden="true" /> Back office
          </h2>
          <span className="td-mono">Staff only</span>
          <button ref={closeRef} type="button" className="td-tbtn td-tbtn--icon" aria-label="Close back office" onClick={requestClose}>
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </header>
        {confirmClose ? (
          <div className="td-staff-confirm" role="alert">
            <span>You have unsaved changes.</span>
            <button type="button" className="td-tbtn" onClick={() => setConfirmClose(false)}>
              <span>Keep editing</span>
            </button>
            <button type="button" className="td-tbtn td-tbtn--ghost" onClick={onClose}>
              <span>Close anyway</span>
            </button>
          </div>
        ) : null}
        <div className="td-staff-body">
          {PUBLISHABLE_KEY ? (
            <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
              <ClerkLoading>
                <p className="td-staff-note">Loading sign-in…</p>
              </ClerkLoading>
              <ClerkFailed>
                <p className="td-staff-note">Sign-in couldn't load (offline, or blocked). Close and try again.</p>
              </ClerkFailed>
              <SignedOut>
                <div className="td-staff-signin">
                  <p className="td-staff-note">Staff sign-in. (It's just Charlie back here.)</p>
                  <SignIn routing="hash" forceRedirectUrl={HOME} appearance={APPEARANCE} />
                </div>
              </SignedOut>
              <SignedIn>
                <Gate
                  catalog={catalog}
                  listsState={listsState}
                  onRetryLists={onRetryLists}
                  onSaved={onSaved}
                  onDirty={setDirty}
                />
              </SignedIn>
            </ClerkProvider>
          ) : (
            <p className="td-staff-note">
              Sign-in isn't configured on this build. Set <code>REACT_APP_CLERK_PUBLISHABLE_KEY</code> and
              rebuild.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
