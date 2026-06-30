import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Wavelength from "./Wavelength";

const renderGame = () =>
  render(
    <MemoryRouter>
      <Wavelength />
    </MemoryRouter>
  );

const startWithTwoPlayers = () => {
  const inputs = document.querySelectorAll(".wv-input");
  fireEvent.change(inputs[0], { target: { value: "Ada" } });
  fireEvent.change(inputs[1], { target: { value: "Linus" } });
  fireEvent.click(screen.getByRole("button", { name: /CALIBRATE & BEGIN/i }));
};

test("renders the setup roster without crashing", () => {
  renderGame();
  expect(screen.getByText(/ROSTER/i)).not.toBeNull();
  expect(document.querySelectorAll(".wv-input").length).toBe(2);
});

test("blocks starting with too few named players", () => {
  renderGame();
  fireEvent.click(screen.getByRole("button", { name: /CALIBRATE & BEGIN/i }));
  expect(screen.getByText(/at least 2 players/i)).not.toBeNull();
});

test("starting deals a round and shows the psychic handoff", () => {
  renderGame();
  startWithTwoPlayers();
  expect(screen.getByText(/PSYCHIC HANDOFF/i)).not.toBeNull();
  expect(screen.getByText(/Ada/)).not.toBeNull();
});

test("full round flow: peek target, pass, lock guess, reach reveal", () => {
  renderGame();
  startWithTwoPlayers();

  // psychic peeks at the target
  fireEvent.click(screen.getByRole("button", { name: /Ada/i }));
  // the interactive dial only exists once the team is guessing
  fireEvent.click(screen.getByRole("button", { name: /HIDE & PASS TO TEAM/i }));
  expect(document.querySelector(".wv-dial.is-interactive")).not.toBeNull();

  // arrow keys drive the slider, then lock
  const dial = document.querySelector(".wv-dial.is-interactive");
  fireEvent.keyDown(dial, { key: "ArrowRight" });
  fireEvent.click(screen.getByRole("button", { name: /LOCK GUESS/i }));

  // reveal shows a score and a running team total
  expect(screen.getByText(/SIGNAL LOCKED/i)).not.toBeNull();
  expect(screen.getByText(/TEAM TOTAL/i)).not.toBeNull();
});
