import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link, Outlet } from "react-router-dom";
import { ClerkProvider, SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import AppIdentity from "../../Components/AppIdentity/AppIdentity";
import InstallButton from "../../Components/AppIdentity/InstallButton";
import "./PantryGate.css";

/*
 * Auth gate for /pantry. Same Clerk app as Budgetter and Bowler; the API
 * (/api/pantry) re-verifies every call against its allowlist, so this is
 * only the front door. No publishable key → a setup notice instead of a
 * crash. It also carries Pantry's home-screen identity, so installing from
 * here (signed in or not) gives an app that opens straight to /pantry.
 */
const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

const FONT = '"Space Grotesk", system-ui, sans-serif';
const APPEARANCE = {
  light: {
    variables: {
      colorPrimary: "#3e6b35",
      colorText: "#1c2119",
      colorBackground: "#fffcf5",
      borderRadius: "14px",
      fontFamily: FONT,
    },
  },
  dark: {
    variables: {
      colorPrimary: "#9fcb8c",
      colorText: "#eef2e9",
      colorBackground: "#1c2219",
      colorInputBackground: "#232a1f",
      colorInputText: "#eef2e9",
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

// Surface colours from Pantry.css, so the status bar matches the page.
const CHROME = {
  light: { themeColor: "#f3eee3", statusBar: "default" },
  dark: { themeColor: "#11140f", statusBar: "black" },
};

const Shell = ({ children }) => (
  <div className="ptg">
    <Helmet>
      <title>Pantry | Charlie Haldane</title>
      <meta name="robots" content="noindex, nofollow" />
    </Helmet>
    <div className="ptg-inner">
      <h1 className="ptg-label">
        <span>Pantry</span>
      </h1>
      {children}
      <Link to="/" className="ptg-back">
        Back to the site
      </Link>
    </div>
  </div>
);

const PantryGate = () => {
  const theme = useSiteTheme();
  const identity = (
    <AppIdentity
      title="Pantry"
      scope="/pantry"
      manifest="/pantry.webmanifest"
      icon="/pantry-icon-180.png"
      {...CHROME[theme]}
    />
  );

  if (!PUBLISHABLE_KEY) {
    return (
      <>
        {identity}
        <Shell>
          <p className="ptg-card">
            Sign-in isn't configured on this build. Set{" "}
            <code>REACT_APP_CLERK_PUBLISHABLE_KEY</code> and restart the dev server.
          </p>
        </Shell>
      </>
    );
  }

  return (
    <>
      {identity}
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
            <p className="ptg-sub">What's in the kitchen, what's running low, what to cook. Household only.</p>
            <InstallButton name="Pantry" className="ptg-install" tipClassName="ptg-card">
              <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" /> Add Pantry to
              your phone
            </InstallButton>
            <div className="ptg-clerk">
              <SignIn routing="hash" forceRedirectUrl="/pantry" />
            </div>
          </Shell>
        </SignedOut>
      </ClerkProvider>
    </>
  );
};

export default PantryGate;
