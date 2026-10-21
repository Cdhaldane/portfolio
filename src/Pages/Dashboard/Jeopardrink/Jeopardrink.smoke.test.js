import React from "react";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Jeopardrink from "./Jeopardrink";

const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

/** A pretend /api/jeopardy: one room, one phone that has joined. */
const fakeApi = () =>
  jest.fn((url, opts = {}) => {
    const op = new URL(url, "http://x").searchParams.get("op");
    if (op === "create") return json(201, { ok: true, code: "BCDF", hostKey: "a".repeat(32) });
    if (op === "poll") {
      return json(200, { ok: true, version: 2, state: {}, seq: 0, players: [{ id: "f".repeat(16), name: "Phone Pat" }], buzzes: [], finals: [] });
    }
    if (op === "state" && opts.method === "PUT") return json(200, { ok: true, version: 3 });
    return json(404, { error: "nope" });
  });

beforeEach(() => {
  localStorage.clear();
  global.fetch = fakeApi();
});

afterEach(() => {
  delete global.fetch;
});

const renderGame = () =>
  render(
    <MemoryRouter>
      <Jeopardrink />
    </MemoryRouter>
  );

const phonesOff = () => fireEvent.click(screen.getByRole("switch", { name: /phone buzzers/i }));

const startWith = (...names) => {
  phonesOff();
  names.forEach((name, i) => {
    if (i >= 2) fireEvent.click(screen.getByRole("button", { name: /ADD PLAYER/i }));
    fireEvent.change(screen.getByLabelText(`Player ${i + 1} name`), { target: { value: name } });
  });
  fireEvent.click(screen.getByRole("button", { name: /LET'S PLAY/i }));
};

/** The top-row ($200) clue of the first category: never a Daily Double. */
const pickFirst200 = () => fireEvent.click(screen.getAllByRole("button", { name: / for \$200$/ })[0]);

test("the setup screen introduces the show", () => {
  renderGame();
  expect(screen.getByRole("heading", { level: 1 })).not.toBeNull();
  expect(screen.getAllByText(/Alex Trebev/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /LET'S PLAY/i })).not.toBeNull();
});

test("phone buzzers open a room with a QR code and list who joined", async () => {
  renderGame();
  expect(await screen.findByLabelText("Room code B C D F")).not.toBeNull();
  expect(screen.getByRole("img", { name: /scan to join room BCDF/i }).tagName.toLowerCase()).toBe("svg");
  expect(await screen.findByText("Phone Pat")).not.toBeNull();
});

test("mid-game, the room pill pops the join QR for late arrivals", async () => {
  renderGame();
  await screen.findByText("Phone Pat");
  fireEvent.change(screen.getByLabelText("Player 1 name"), { target: { value: "Dana" } });
  fireEvent.click(screen.getByRole("button", { name: /LET'S PLAY/i }));
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /Room BCDF: show the join QR code/i }));
  const sheet = screen.getByRole("dialog", { name: /Grab a buzzer/i });
  expect(within(sheet).getByRole("img", { name: /scan to join room BCDF/i })).not.toBeNull();
  expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "Close" }));

  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("it takes two to play", () => {
  renderGame();
  startWith("Solo");
  expect(screen.getByRole("alert").textContent).toMatch(/at least 2 players/i);
});

test("starting deals a 6 x 5 board", () => {
  renderGame();
  startWith("Dana", "Sam");
  expect(screen.getAllByRole("button", { name: / for \$\d+$/ })).toHaveLength(30);
  expect(screen.getAllByText(/picks/i).length).toBeGreaterThan(0);
});

test("a clue: pick it, ring someone in, judge it, back to the board", () => {
  renderGame();
  startWith("Dana", "Sam");
  pickFirst200();
  expect(screen.getByText(/Host eyes only/i)).not.toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /Answering: Sam/ }));
  fireEvent.click(screen.getByRole("button", { name: /CORRECT/ }));
  expect(screen.getByRole("status").textContent).toMatch(/CORRECT!.*SAM \+\$200/);

  fireEvent.click(screen.getByRole("button", { name: /BACK TO THE BOARD/i }));
  expect(screen.getAllByRole("button", { name: /\$200, played/ })).toHaveLength(1);
});

test("a wrong answer pours a drink, and undo takes it back", () => {
  renderGame();
  startWith("Dana", "Sam");
  pickFirst200();
  fireEvent.click(screen.getByRole("button", { name: /Answering: Dana/ }));
  fireEvent.click(screen.getByRole("button", { name: /WRONG/ }));
  expect(screen.getByRole("status").textContent).toMatch(/DANA, DRINK 1/);
  expect(screen.getByRole("button", { name: /Answering: Dana/ }).disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: /Undo last move/i }));
  expect(screen.getByRole("button", { name: /CORRECT/ })).not.toBeNull();
});

test("sober mode keeps the points and drops the sips", () => {
  renderGame();
  fireEvent.click(screen.getByRole("switch", { name: /Drinking rules/i }));
  startWith("Dana", "Sam");
  pickFirst200();
  fireEvent.click(screen.getByRole("button", { name: /NOBODY GOT IT/i }));
  expect(screen.getByRole("status").textContent).toMatch(/NOBODY GOT IT/);
  expect(screen.getByRole("status").textContent).not.toMatch(/SIP/);
});

test("a game in progress survives a reload", () => {
  const first = renderGame();
  startWith("Dana", "Sam");
  first.unmount();

  renderGame();
  const resume = within(screen.getByText(/Game in progress/i).closest("section"));
  fireEvent.click(resume.getByRole("button", { name: /RESUME/i }));
  expect(screen.getAllByRole("button", { name: / for \$\d+$/ })).toHaveLength(30);
});

test("ending the round early goes to the intermission", async () => {
  renderGame();
  startWith("Dana", "Sam");
  fireEvent.click(screen.getByRole("button", { name: /END ROUND EARLY/i }));
  expect(screen.getByText(/How we're doing/i)).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /DOUBLE JEOPARDRINK/i }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: / for \$400$/ }).length).toBeGreaterThan(0));
  expect(screen.getAllByRole("button", { name: / for \$2000$/ })).toHaveLength(6);
});
