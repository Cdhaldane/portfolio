// ThemeSwitch.test.js
import React from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ThemeSwitch, { initializeTheme } from "./ThemeSwitch";


/**
 * ThemeSwitch Component Test Suite
 *
 * Purpose:
 * - This suite verifies the functionality of the `ThemeSwitch` component, ensuring it correctly initializes, renders, and toggles between light and dark modes based on user interaction and localStorage values.
 *
 * Tests:
 * - `initializes light mode if 'isDarkMode' is false in localStorage`: Confirms that light mode is initialized when `isDarkMode` is set to false in localStorage.
 * - `initializes dark mode if 'isDarkMode' is true in localStorage`: Confirms that dark mode is initialized when `isDarkMode` is set to true in localStorage.
 * - `renders theme switch component`: Ensures that both the sun and moon icons (for toggling light and dark mode) are rendered.
 * - `activates light mode when sun icon is clicked`: Simulates clicking the sun icon to switch to light mode, updating localStorage and applying the correct class to `document.body`.
 * - `activates dark mode when moon icon is clicked`: Simulates clicking the moon icon to switch to dark mode, updating localStorage and applying the correct class to `document.body`.
 * - `switches modes based on localStorage value`: Verifies that the component correctly reflects the initial mode based on localStorage and can toggle between modes.
 *
 * Setup:
 * - Clears localStorage and removes `light-mode` class from `document.body` before each test to ensure a consistent starting state.
 */


describe("ThemeSwitch Component", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.classList.remove("light-mode");
  });

  test("initializes light mode if 'isDarkMode' is false in localStorage", () => {
    localStorage.setItem("isDarkMode", JSON.stringify(false));
    initializeTheme();

    expect(document.body.classList).toContain("light-mode");
  });

  test("initializes dark mode if 'isDarkMode' is true in localStorage", () => {
    localStorage.setItem("isDarkMode", JSON.stringify(true));
    initializeTheme();

    expect(document.body.classList).not.toContain("light-mode");
  });

  test("renders theme switch component", () => {
    render(<ThemeSwitch />);

    const sunIcon = screen.getByLabelText("Activate Light Mode");
    const moonIcon = screen.getByLabelText("Activate Dark Mode");

    expect(sunIcon).toBeInTheDocument();
    expect(moonIcon).toBeInTheDocument();
  });

  test("activates light mode when sun icon is clicked", () => {
    render(<ThemeSwitch />);

    const sunIcon = screen.getByLabelText("Activate Light Mode");
    fireEvent.click(sunIcon);

    expect(localStorage.getItem("isDarkMode")).toBe("false");
    expect(document.body.classList).toContain("light-mode");
  });

  test("activates dark mode when moon icon is clicked", () => {
    render(<ThemeSwitch />);

    const moonIcon = screen.getByLabelText("Activate Dark Mode");
    fireEvent.click(moonIcon);

    expect(localStorage.getItem("isDarkMode")).toBe("true");
    expect(document.body.classList).not.toContain("light-mode");
  });

  test("switches modes based on localStorage value", () => {
    localStorage.setItem("isDarkMode", JSON.stringify(true));
    render(<ThemeSwitch />);

    const moonIcon = screen.getByLabelText("Activate Dark Mode");
    expect(moonIcon.classList).toContain("switch-active");
    expect(document.body.classList).not.toContain("light-mode");

    const sunIcon = screen.getByLabelText("Activate Light Mode");
    fireEvent.click(sunIcon);

    expect(localStorage.getItem("isDarkMode")).toBe("false");
    expect(document.body.classList).toContain("light-mode");
  });
});
