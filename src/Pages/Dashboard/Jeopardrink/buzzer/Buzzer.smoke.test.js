import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Buzzer from "./Buzzer";

const PID = "a1b2c3d4e5f60718";
const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

const clueState = (overrides = {}) => ({
  phase: "clue",
  round: 0,
  rounds: 2,
  board: [{ name: "Potent Potables", cells: [{ value: 200, used: false }] }],
  clue: { cat: "Potent Potables", value: 200, dd: false, wager: null, resolved: null, answer: null },
  buzz: { open: true, seq: 4, locked: [] },
  answering: null,
  control: null,
  roster: [{ id: PID, name: "Pat", score: 400 }],
  callout: null,
  lastCall: null,
  drinking: true,
  ...overrides,
});

/** A pretend /api/jeopardy serving whatever `room.state` currently is. */
const fakeApi = (room) =>
  jest.fn((url, opts = {}) => {
    const op = new URL(url, "http://x").searchParams.get("op");
    if (op === "join") return json(201, { ok: true, code: "BCDF", playerId: PID, secret: "b".repeat(32), name: "Pat" });
    if (op === "poll") return json(200, { ok: true, version: room.version, state: room.state, first: null });
    if (op === "buzz") {
      room.buzzBody = JSON.parse(opts.body);
      return json(200, { ok: true, accepted: true, first: PID });
    }
    return json(404, { error: "nope" });
  });

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/buzz" element={<Buzzer />} />
        <Route path="/buzz/:code" element={<Buzzer />} />
      </Routes>
    </MemoryRouter>
  );

let room;
beforeEach(() => {
  localStorage.clear();
  room = { version: 1, state: clueState() };
  global.fetch = fakeApi(room);
});
afterEach(() => {
  delete global.fetch;
});

const join = async () => {
  fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: "Pat" } });
  fireEvent.click(screen.getByRole("button", { name: /I'M IN/i }));
};

test("the room code comes from the link and filters to code letters", () => {
  renderAt("/buzz/bc1df");
  expect(screen.getByLabelText(/Room code/i).value).toBe("BCDF");
});

test("joining needs a full code", () => {
  renderAt("/buzz");
  fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: "Pat" } });
  fireEvent.click(screen.getByRole("button", { name: /I'M IN/i }));
  expect(screen.getByRole("alert").textContent).toMatch(/four letters/i);
});

test("join, see the live buzzer, buzz on the current window", async () => {
  renderAt("/buzz/BCDF");
  await join();
  const buzzer = await screen.findByRole("button", { name: "BUZZ!" });
  fireEvent.pointerDown(buzzer);
  fireEvent.click(buzzer); // the follow-up click must not double-buzz
  await waitFor(() => expect(room.buzzBody).toMatchObject({ code: "BCDF", playerId: PID, seq: 4 }));
  expect(global.fetch.mock.calls.filter(([u]) => u.includes("op=buzz"))).toHaveLength(1);
});

test("a remembered seat skips the join form", async () => {
  localStorage.setItem(
    "jeopardrink-seat-v1:BCDF",
    JSON.stringify({ code: "BCDF", playerId: PID, secret: "b".repeat(32), name: "Pat" })
  );
  room.state = clueState({ buzz: { open: false, seq: 4, locked: [] } });
  renderAt("/buzz/BCDF");
  expect(await screen.findByRole("button", { name: /WAIT FOR IT/ })).not.toBeNull();
});

test("the lobby greets you before the game starts", async () => {
  room.state = { phase: "lobby" };
  renderAt("/buzz/BCDF");
  await join();
  expect(await screen.findByText(/You're in, Pat!/)).not.toBeNull();
});
