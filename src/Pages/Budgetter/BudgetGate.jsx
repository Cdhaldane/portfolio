import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, Outlet } from "react-router-dom";
import { ClerkProvider, SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import BudBackground from "./BudBackground";
import "./BudgetGate.css";

/*
 * Auth gate for the private /budgetter tree.
 *
 * Unlike the dashboard's shared-passcode gate, this is real per-user auth:
 * Clerk issues a session, and every /api/budget/* call re-verifies that
 * session server-side against a fail-closed user allowlist. This component
 * is only the front door — the API layer is the actual security boundary.
 *
 * Sign-ups are disabled in the Clerk dashboard; the ~5 accounts are created
 * by hand there. No key configured → a setup notice instead of a crash, so
 * the rest of the site never depends on Clerk being wired up.
 */
const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

// Match Clerk's prebuilt SignIn to the site's token set — per theme, since
// Clerk's card doesn't read our CSS variables. The active theme lives on
// <html data-theme> (set by ThemeSwitch); a MutationObserver keeps the
// appearance in sync no matter what flips it (switch, ⌘K palette).
const CLERK_APPEARANCE = {
  light: {
    variables: {
      colorPrimary: "#2f6bff",
      colorText: "#1a1a17",
      colorBackground: "#ffffff",
      borderRadius: "12px",
      fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif',
    },
  },
  dark: {
    variables: {
      colorPrimary: "#6e93ff",
      colorText: "#eef2e9",
      colorBackground: "#1d1f1a",
      colorInputBackground: "#24261f",
      colorInputText: "#eef2e9",
      borderRadius: "12px",
      fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif',
    },
  },
};

const useSiteTheme = () => {
  const read = () =>
    document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
};

const GateShell = ({ children }) => (
  <div className="bud-gate">
    <BudBackground />
    <Helmet>
      <title>Budgetter | Charlie Haldane</title>
      {/* Private tool — never indexed, never previewed. */}
      <meta name="robots" content="noindex, nofollow" />
    </Helmet>
    <div className="bud-gate-inner">
      <p className="bud-gate-kicker">Private / 01</p>
      <h1 className="bud-gate-title">Budgetter</h1>
      {children}
      <Link to="/" className="bud-gate-back">
        ← Back to the site
      </Link>
    </div>
  </div>
);

const BudgetGate = () => {
  const theme = useSiteTheme();

  if (!PUBLISHABLE_KEY) {
    return (
      <GateShell>
        <div className="bud-gate-card bud-gate-setup">
          <p className="bud-gate-mono">SETUP REQUIRED</p>
          <p>
            Auth isn't configured yet. Create a Clerk app (sign-ups disabled),
            then set <code>REACT_APP_CLERK_PUBLISHABLE_KEY</code> in{" "}
            <code>.env.local</code> and restart the dev server.
          </p>
        </div>
      </GateShell>
    );
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={CLERK_APPEARANCE[theme]}
    >
      <SignedIn>
        <Helmet>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <GateShell>
          <p className="bud-gate-sub">
            A private spending tracker. Accounts are invite-only — if you're
            not one of the five, this is as far as the tour goes.
          </p>
          <div className="bud-gate-clerk">
            {/* Without forceRedirectUrl, Clerk's post-sign-in default is "/". */}
            <SignIn routing="hash" forceRedirectUrl="/budgetter" />
          </div>
        </GateShell>
      </SignedOut>
    </ClerkProvider>
  );
};

export default BudgetGate;
