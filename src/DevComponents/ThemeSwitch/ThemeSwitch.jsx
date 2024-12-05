import React, { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isReadable } from "../../Utils";
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

function ThemeSwitch({ className = "", organization }) {
  const [isDarkMode, setIsDarkMode] = useState(
    JSON.parse(localStorage.getItem("isDarkMode")) || false
  );
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

    localStorage.setItem("isDarkMode", isDarkMode);

    if (!organization) return;

    const isHomePage = location.pathname.includes("home");

    const defaultLightPrimary = "#4b4b4b";
    const defaultDarkPrimary = "#88f188";
    const defaultSecondary = "#ee8484";
    const backgroundColor = isDarkMode ? "#2d2d2a" : "#fdfdfd";

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
  const isDarkMode = JSON.parse(localStorage.getItem("isDarkMode")) || false;
  if (isDarkMode) {
    document.body.classList.remove("light-mode");
  } else {
    document.body.classList.add("light-mode");
  }
};
