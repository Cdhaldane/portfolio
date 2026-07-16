import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DeadReckoning from "./DeadReckoning";
import { getDailyRounds, PEOPLE, ROUNDS_PER_DAY } from "./people";
import { isCorrectGuess, normalize, levenshtein } from "./fuzzy";

// The leaderboard fetches on the final screen; stub it so jsdom never
// actually performs network I/O.
beforeEach(() => {
  localStorage.clear();
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ configured: true, entries: [] }),
    })
  );
});

const renderGame = () =>
  render(
    <MemoryRouter>
      <DeadReckoning />
    </MemoryRouter>
  );

const guessInput = () => screen.getByLabelText(/your guess/i);

test("dataset: 200 unique people with valid coordinates and dates", () => {
  expect(PEOPLE.length).toBe(200);
  const names = new Set(PEOPLE.map((p) => p.name));
  expect(names.size).toBe(200);
  PEOPLE.forEach((p) => {
    expect(p.born.date).toBeTruthy();
    expect(p.died.date).toBeTruthy();
    expect(Math.abs(p.born.lat)).toBeLessThanOrEqual(85);
    expect(Math.abs(p.died.lat)).toBeLessThanOrEqual(85);
    expect(Math.abs(p.born.lng)).toBeLessThanOrEqual(180);
    expect(Math.abs(p.died.lng)).toBeLessThanOrEqual(180);
  });
});

test("daily selection is deterministic for a date and rotates between days", () => {
  const d1 = getDailyRounds(new Date(2026, 6, 16));
  const d2 = getDailyRounds(new Date(2026, 6, 16));
  const d3 = getDailyRounds(new Date(2026, 6, 17));
  expect(d1.rounds.map((r) => r.name)).toEqual(d2.rounds.map((r) => r.name));
  expect(d1.rounds.map((r) => r.name)).not.toEqual(d3.rounds.map((r) => r.name));
  expect(new Set(d1.rounds.map((r) => r.name)).size).toBe(ROUNDS_PER_DAY);
});

test("fuzzy matching forgives misspellings and accepts surnames/aliases", () => {
  const einstein = PEOPLE.find((p) => p.name === "Albert Einstein");
  expect(isCorrectGuess("einstien", einstein)).toBe(true);
  expect(isCorrectGuess("Einstein", einstein)).toBe(true);
  expect(isCorrectGuess("isaac newton", einstein)).toBe(false);
  const ali = PEOPLE.find((p) => p.name === "Muhammad Ali");
  expect(isCorrectGuess("cassius clay", ali)).toBe(true);
  expect(normalize("Salvador Dalí")).toBe("salvador dali");
  expect(levenshtein("kitten", "sitting")).toBe(3);
});

test("renders the daily round with born/died pins and dates", () => {
  renderGame();
  const { rounds } = getDailyRounds();
  expect(screen.getByText(/DEAD/)).not.toBeNull();
  // pin labels (the footer legend also says BORN/DIED, hence getAll)
  expect(screen.getAllByText("BORN").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("DIED").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText(rounds[0].born.date)).not.toBeNull();
});

test("a wrong guess is logged and costs points", () => {
  renderGame();
  fireEvent.change(guessInput(), { target: { value: "definitely wrong person" } });
  fireEvent.click(screen.getByRole("button", { name: /^GUESS$/i }));
  expect(screen.getByText(/definitely wrong person/)).not.toBeNull();
  expect(screen.getByText("925")).not.toBeNull(); // 1000 - 75 at stake
});

test("a correct (misspelled) guess reveals the identity and score", () => {
  renderGame();
  const { rounds } = getDailyRounds();
  // butcher the name slightly: drop its 4th character (1 edit — always forgiven)
  const raw = rounds[0].name;
  const mangled = raw.slice(0, 3) + raw.slice(4);
  fireEvent.change(guessInput(), { target: { value: mangled } });
  fireEvent.click(screen.getByRole("button", { name: /^GUESS$/i }));
  expect(screen.getByText(/IDENTITY CONFIRMED/i)).not.toBeNull();
  expect(screen.getByText(rounds[0].name)).not.toBeNull();
});

test("giving up on all rounds reaches the final board and leaderboard", async () => {
  renderGame();
  for (let i = 0; i < ROUNDS_PER_DAY; i++) {
    fireEvent.click(screen.getByRole("button", { name: /GIVE UP/i }));
    expect(screen.getByText(/CASE CLOSED/i)).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: i === ROUNDS_PER_DAY - 1 ? /SEE THE BOARD/i : /NEXT DOSSIER/i })
    );
  }
  expect(screen.getByText(/FINAL RECKONING/i)).not.toBeNull();
  expect(await screen.findByText(/DAILY LEADERBOARD/i)).not.toBeNull();
  expect(global.fetch).toHaveBeenCalled();
});

test("free play deals endless rounds", () => {
  renderGame();
  fireEvent.click(screen.getByRole("tab", { name: /^FREE$/i }));
  expect(screen.getByText(/SESSION/i)).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /GIVE UP/i }));
  fireEvent.click(screen.getByRole("button", { name: /NEXT DOSSIER/i }));
  expect(screen.getAllByText("BORN").length).toBeGreaterThanOrEqual(2);
});
