import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, Outlet } from "react-router-dom";
import { ClerkProvider, SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import "./GarageGate.css";

/*
 * Auth gate for /garage. Same Clerk app and fail-closed allowlist as Budgetter
 * and Bowler; the API (/api/telemetry) re-verifies every call, so this is only
 * the front door. Datalogs can carry where the car was driven, so nothing past
 * this door renders for a signed-out visitor. No publishable key → a setup
 * notice instead of a crash.
 */
const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

const FONT = '"Space Grotesk", system-ui, sans-serif';
const APPEARANCE = {
  light: {
    variables: {
      colorPrimary: "#15171a",
      colorText: "#15171a",
      colorBackground: "#f7f8f4",
      borderRadius: "12px",
      fontFamily: FONT,
    },
  },
  dark: {
    variables: {
      colorPrimary: "#7fa6ff",
      colorText: "#e8ebef",
      colorBackground: "#161a20",
      colorInputBackground: "#1d222a",
      colorInputText: "#e8ebef",
      borderRadius: "12px",
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
  <div className="grg">
    <Helmet>
      <title>Garage | Charlie Haldane</title>
      <meta name="robots" content="noindex, nofollow" />
    </Helmet>
    <div className="grg-inner">
      <p className="grg-kicker">Private · two cars</p>
      <h1 className="grg-title">Garage</h1>
      {children}
      <Link to="/" className="grg-back">
        Back to the site
      </Link>
    </div>
  </div>
);

const GarageGate = () => {
  const theme = useSiteTheme();

  if (!PUBLISHABLE_KEY) {
    return (
      <Shell>
        <p className="grg-card">
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
          <title>Garage | Charlie Haldane</title>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <Shell>
          <p className="grg-sub">Datalogs, service history and trends. Members only.</p>
          <div className="grg-clerk">
            <SignIn routing="hash" forceRedirectUrl="/garage" />
          </div>
        </Shell>
      </SignedOut>
    </ClerkProvider>
  );
};

export default GarageGate;
