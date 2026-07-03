import React, { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import "./ThemeSwitch.css";

/**
 * ThemeSwitch Component
 *
 * Purpose:
 * - The ThemeSwitch component provides a toggle switch for switching between light and dark modes.
 * - It updates the theme of the application and persists the theme selection in local storage.
 *
 * Inputs:
 * - className: Additional CSS class names for styling.
 * - organization: The organization object to apply primary/secondary colors.
 *
 * Outputs:
 * - JSX for rendering the theme switch with icons for light and dark modes.
 */

/**
 * Resolve the starting theme: an explicit stored choice wins; otherwise fall
 * back to the OS-level colour-scheme preference.
 */
const getInitialDarkMode = () => {
  const stored = localStorage.getItem("isDarkMode");
  if (stored !== null) return JSON.parse(stored);
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
};

function ThemeSwitch({ className = "", organization }) {
  const [isDarkMode, setIsDarkMode] = useState(getInitialDarkMode);
  const sunRef = useRef(null);
  const moonRef = useRef(null);
  const location = useLocation();

  useEffect(() => {
    if (!isDarkMode) {
      moonRef.current?.classList.remove("switch-active");
      sunRef.current?.classList.add("switch-active");
      document.body.classList.add("light-mode");
    } else {
      moonRef.current?.classList.add("switch-active");
      sunRef.current?.classList.remove("switch-active");
      document.body.classList.remove("light-mode");
    }

    // The data-theme attribute on <html> is the single source of truth that all
    // CSS variables key off of (see App.css / About.css).
    document.documentElement.setAttribute(
      "data-theme",
      isDarkMode ? "dark" : "light"
    );

    localStorage.setItem("isDarkMode", isDarkMode);

    if (!organization) return;


    const defaultLightPrimary = "#4b4b4b";
    const defaultDarkPrimary = "#88f188";
    const defaultSecondary = "#ee8484";

    const primaryColor = organization.org_settings?.primaryColor
      ? organization.org_settings.primaryColor
      : isDarkMode
      ? defaultDarkPrimary // Default dark mode primary
      : defaultLightPrimary; // Default light mode primary

    const secondaryColor = organization.org_settings?.secondaryColor
      ? organization.org_settings.secondaryColor
      : defaultSecondary; // Default secondary

    // Update global primary and secondary colors
    document.documentElement.style.setProperty("--primary", primaryColor);
    document.documentElement.style.setProperty("--secondary", secondaryColor);

    // Update .light-mode specific primary color
    if (!isDarkMode) {
      document
        .querySelector(".light-mode")
        ?.style.setProperty("--primary", primaryColor);

      document
        .querySelector(".light-mode")
        ?.style.setProperty("--secondary", secondaryColor);
    }
  }, [isDarkMode, organization, location.pathname]);

  // Stay in sync when the theme is flipped elsewhere (e.g. the ⌘K command
  // palette), which updates storage then dispatches a "themechange" event.
  useEffect(() => {
    const sync = () => setIsDarkMode(getInitialDarkMode());
    window.addEventListener("themechange", sync);
    return () => window.removeEventListener("themechange", sync);
  }, []);

  return (
    <div className={`theme-switch ${className}`}>
      <label className="switch">
        <i
          ref={sunRef}
          className="fa-solid fa-sun"
          onClick={() => setIsDarkMode(false)}
          aria-label="Activate Light Mode"
        ></i>
        <div
          className={`slider-theme ${
            isDarkMode ? "slider-moon" : "slider-sun"
          }`}
        ></div>
        <i
          ref={moonRef}
          className="fa-solid fa-moon"
          onClick={() => setIsDarkMode(true)}
          aria-label="Activate Dark Mode"
        ></i>
      </label>
    </div>
  );
}

export default ThemeSwitch;

/**
 * Initialize Theme on App Load
 */
export const initializeTheme = () => {
  const isDarkMode = getInitialDarkMode();
  document.documentElement.setAttribute(
    "data-theme",
    isDarkMode ? "dark" : "light"
  );
  if (isDarkMode) {
    document.body.classList.remove("light-mode");
  } else {
    document.body.classList.add("light-mode");
  }
};
