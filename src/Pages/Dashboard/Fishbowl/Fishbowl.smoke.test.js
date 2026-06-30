import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Fishbowl from "./Fishbowl";

const renderGame = () =>
  render(
    <MemoryRouter>
      <Fishbowl />
    </MemoryRouter>
  );

const seedAndStart = () => {
  fireEvent.click(screen.getByRole("button", { name: /ADD SAMPLES/i }));
  fireEvent.click(screen.getByRole("button", { name: /SEAL THE BOWL & START/i }));
};

test("renders the setup intake terminal without crashing", () => {
  renderGame();
  expect(screen.getByText(/FILL THE BOWL/i)).not.toBeNull();
  expect(screen.getByText(/0 WORDS/i)).not.toBeNull();
});

test("blocks starting with an under-filled bowl", () => {
  renderGame();
  fireEvent.click(screen.getByRole("button", { name: /SEAL THE BOWL & START/i }));
  expect(screen.getByText(/at least 8 words/i)).not.toBeNull();
});

test("adding samples fills the bowl and starts round 1", () => {
  renderGame();
  fireEvent.click(screen.getByRole("button", { name: /ADD SAMPLES/i }));
  expect(screen.getByText(/30 WORDS/i)).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /SEAL THE BOWL & START/i }));
  expect(screen.getByText(/ROUND 1 OF 3/i)).not.toBeNull();
  expect(screen.getByText(/ON THE CLOCK/i)).not.toBeNull();
});

test("a turn shows a word and GOT IT scores a point", () => {
  renderGame();
  seedAndStart();
  fireEvent.click(screen.getByRole("button", { name: /START .* TURN/i }));

  // a word from the bowl is on the stage
  const word = document.querySelector(".fb-word");
  expect(word).not.toBeNull();
  expect(word.textContent.trim().length).toBeGreaterThan(0);

  // GOT IT advances the per-turn tally
  fireEvent.click(screen.getByRole("button", { name: /GOT IT/i }));
  expect(screen.getByText(/GOT 1 THIS TURN/i)).not.toBeNull();
});

test("manual word entry adds to the bowl count", () => {
  renderGame();
  const input = document.querySelector(".fb-input");
  fireEvent.change(input, { target: { value: "Pineapple" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText(/1 WORDS/i)).not.toBeNull();
});
