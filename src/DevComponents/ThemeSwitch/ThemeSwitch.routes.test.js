import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ThemeSwitch from "./ThemeSwitch";

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeSwitch className="global-theme" />
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
});

test("floats on regular routes", () => {
  renderAt("/");
  expect(screen.getByRole("group", { name: "Colour theme" })).toBeTruthy();
});

test("steps aside on the always-dark Top 5 page", () => {
  renderAt("/dashboard/top5");
  expect(screen.queryByRole("group", { name: "Colour theme" })).toBeNull();
});

test("keeps applying the stored theme while hidden", () => {
  localStorage.setItem("isDarkMode", "true");
  renderAt("/dashboard/top5");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});
