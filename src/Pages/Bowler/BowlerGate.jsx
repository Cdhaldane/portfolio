import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, Outlet } from "react-router-dom";
import { ClerkProvider, SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import "./BowlerGate.css";

/*
 * Auth gate for /bowler. Same Clerk app and fail-closed allowlist as
 * Budgetter; the API (/api/bowler) re-verifies every call, so this is only
 * the front door. No publishable key → a setup notice instead of a crash.
 */
const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

const FONT = '"Space Grotesk", system-ui, sans-serif';
const APPEARANCE = {
  light: {
    variables: {
      colorPrimary: "#2b1d16",
      colorText: "#2b1d16",
      colorBackground: "#fffaf0",
      borderRadius: "14px",
      fontFamily: FONT,
    },
  },
  dark: {
    variables: {
      colorPrimary: "#f2b84b",
      colorText: "#f5ecdc",
      colorBackground: "#231d2e",
      colorInputBackground: "#2c2539",
      colorInputText: "#f5ecdc",
      borderRadius: "14px",
      fontFamily: FONT,
    },
  },
};

const readTheme = () =>
  document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";

const useSiteTheme = () => {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
};

const Shell = ({ children }) => (
  <div className="bwg">
    <Helmet>
      <title>Bowler | Charlie Haldane</title>
      <meta name="robots" content="noindex, nofollow" />
    </Helmet>
    <div className="bwg-inner">
      <h1 className="bwg-sign">Bowler</h1>
      {children}
      <Link to="/" className="bwg-back">
        Back to the site
      </Link>
    </div>
  </div>
);

const BowlerGate = () => {
  const theme = useSiteTheme();

  if (!PUBLISHABLE_KEY) {
    return (
      <Shell>
        <p className="bwg-card">
          Sign-in isn't configured on this build. Set{" "}
          <code>REACT_APP_CLERK_PUBLISHABLE_KEY</code> and restart the dev server.
        </p>
      </Shell>
    );
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={APPEARANCE[theme]}
    >
      <SignedIn>
        <Helmet>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <Shell>
          <p className="bwg-sub">League night scores for two. Members only.</p>
          <div className="bwg-clerk">
            <SignIn routing="hash" forceRedirectUrl="/bowler" />
          </div>
        </Shell>
      </SignedOut>
    </ClerkProvider>
  );
};

export default BowlerGate;
