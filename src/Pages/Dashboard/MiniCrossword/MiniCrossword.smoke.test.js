import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import MiniCrossword from "./MiniCrossword";
import { getDailyPuzzle } from "./puzzles";

const renderGame = () =>
  render(
    <MemoryRouter>
      <MiniCrossword />
    </MemoryRouter>
  );

beforeEach(() => {
  window.localStorage.clear();
});

test("renders the grid, clues and timer without crashing", () => {
  renderGame();
  expect(screen.getAllByText(/Across/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Down/i).length).toBeGreaterThan(0);
  // 25 cells rendered (5x5)
  expect(document.querySelectorAll(".xw-cell").length).toBe(25);
  // today's first across clue is shown
  const { puzzle } = getDailyPuzzle();
  expect(screen.getAllByText(puzzle.across[0].clue).length).toBeGreaterThan(0);
});

test("filling every cell with the solution triggers the win state", () => {
  renderGame();
  const { puzzle } = getDailyPuzzle();
  const gridWrap = document.querySelector(".xw-grid-wrap");
  const cells = document.querySelectorAll(".xw-cell");
  // Deterministically click each white cell and press its solution letter.
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const ch = puzzle.grid[r][c];
      if (ch === "#") continue;
      fireEvent.click(cells[r * 5 + c]);
      fireEvent.keyDown(gridWrap, { key: ch });
    }
  }
  expect(screen.queryByText(/PUZZLE SOLVED/i)).not.toBeNull();
});

test("Reveal fills the grid and marks it solved", () => {
  renderGame();
  fireEvent.click(screen.getByRole("button", { name: /Reveal/i }));
  expect(screen.queryByText(/PUZZLE SOLVED/i)).not.toBeNull();
});

test("an incorrect letter does not trigger a win", () => {
  renderGame();
  const gridWrap = document.querySelector(".xw-grid-wrap");
  const cells = document.querySelectorAll(".xw-cell");
  fireEvent.click(cells[0]);
  fireEvent.keyDown(gridWrap, { key: "Z" });
  expect(screen.queryByText(/PUZZLE SOLVED/i)).toBeNull();
});
