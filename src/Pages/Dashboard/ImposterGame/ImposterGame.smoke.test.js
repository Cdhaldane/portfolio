import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import ImposterGame from "./ImposterGame";
import { CATEGORIES } from "./words";

/* Stands in for the browser / phone back gesture. */
const HistoryBack = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>BROWSER BACK</button>;
};

const renderGame = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard", "/dashboard/imposter"]} initialIndex={1}>
      <ImposterGame />
      <HistoryBack />
    </MemoryRouter>
  );

const nameInputs = () => screen.getAllByLabelText(/^Agent \d+ name$/);

const enterNames = (names) => {
  names.forEach((n, i) => {
    if (i >= nameInputs().length) fireEvent.click(screen.getByRole("button", { name: /ADD AGENT/i }));
    fireEvent.change(nameInputs()[i], { target: { value: n } });
  });
};

const start = () => fireEvent.click(screen.getByRole("button", { name: /INITIALIZE ROUND/i }));

const chaosOff = () => {
  const sw = screen.getByRole("switch", { name: /CHAOS ROUNDS/i });
  if (sw.getAttribute("aria-checked") === "true") fireEvent.click(sw);
};

beforeEach(() => window.localStorage.clear());

test("renders the setup terminal with every dataset shelf", () => {
  renderGame();
  expect(screen.getByText("ROSTER")).not.toBeNull();
  expect(screen.getByText("DATASETS")).not.toBeNull();
  CATEGORIES.forEach((c) => expect(screen.getByRole("button", { name: c.name })).not.toBeNull());
});

test("blocks starting without enough agents", () => {
  renderGame();
  enterNames(["Ana", "Ben"]);
  start();
  expect(screen.getByText(/at least 3 agents/i)).not.toBeNull();
});

test("names and rules survive leaving the page", () => {
  const view = renderGame();
  enterNames(["Ana", "Ben", "Cy"]);
  chaosOff();
  view.unmount();

  renderGame();
  expect(nameInputs().map((i) => i.value)).toEqual(["Ana", "Ben", "Cy"]);
  expect(screen.getByRole("switch", { name: /CHAOS ROUNDS/i }).getAttribute("aria-checked")).toBe("false");
});

test("a full round: one imposter, a shared word, and a hint that belongs to it", () => {
  renderGame();
  enterNames(["Ana", "Ben", "Cy", "Dee"]);
  chaosOff();
  start();

  const roles = [];
  for (let i = 0; i < 4; i++) {
    const card = screen.getByRole("button", { name: /Reveal .* role/ });
    // the secret isn't in the DOM until the card is opened
    expect(document.querySelector(".imp-word, .imp-decoy")).toBeNull();
    fireEvent.click(card);
    const category = document.querySelector(".imp-card-cat").textContent.trim();
    const word = document.querySelector(".imp-word");
    const hint = document.querySelector(".imp-decoy strong");
    roles.push({ category, word: word && word.textContent, hint: hint && hint.textContent });
    fireEvent.click(screen.getByRole("button", { name: /LOCK & (PASS|BEGIN)/ }));
  }

  const imposters = roles.filter((r) => !r.word);
  const crew = roles.filter((r) => r.word);
  expect(imposters).toHaveLength(1);
  expect(new Set(crew.map((r) => r.word)).size).toBe(1);

  const cat = CATEGORIES.find((c) => c.name === roles[0].category);
  const entry = cat.words.find(([w]) => w === crew[0].word);
  expect(entry).toBeDefined();
  expect(entry.slice(1)).toContain(imposters[0].hint);

  expect(screen.getByText("FIRST TO SPEAK")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /REVEAL THE TRUTH/i }));
  expect(screen.getByText("THE IMPOSTER WAS")).not.toBeNull();
});

test("the back control mid-round returns to setup with the roster intact", () => {
  renderGame();
  enterNames(["Ana", "Ben", "Cy"]);
  start();
  fireEvent.click(screen.getByRole("button", { name: "Back to setup" }));
  expect(screen.getByText("ROSTER")).not.toBeNull();
  expect(nameInputs().map((i) => i.value)).toEqual(["Ana", "Ben", "Cy"]);
});

test("the browser back gesture mid-round also lands on setup", () => {
  renderGame();
  enterNames(["Ana", "Ben", "Cy"]);
  start();
  expect(screen.queryByText("ROSTER")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "BROWSER BACK" }));
  expect(screen.getByText("ROSTER")).not.toBeNull();
  expect(nameInputs().map((i) => i.value)).toEqual(["Ana", "Ben", "Cy"]);
});

test("Enter on the last name adds a row and focuses it", () => {
  renderGame();
  enterNames(["Ana", "Ben", "Cy"]);
  fireEvent.keyDown(nameInputs()[2], { key: "Enter" });
  expect(nameInputs()).toHaveLength(4);
  expect(document.activeElement).toBe(nameInputs()[3]);
});
