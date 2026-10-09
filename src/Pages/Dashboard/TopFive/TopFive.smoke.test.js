import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import "@testing-library/jest-dom";
import { MotionGlobalConfig } from "framer-motion";
import TopFive from "./TopFive";
import Dashboard from "../Dashboard";

// Role queries walk a big DOM (40 checklist rows, 8 packs, 5 cards).
jest.setTimeout(20000);

// useReducedMotion is read per test; framer caches the media query otherwise.
let mockReduced = false;
jest.mock("framer-motion", () => ({
  ...jest.requireActual("framer-motion"),
  useReducedMotion: () => mockReduced,
}));

// framer finishes animations (and fires onAnimationComplete) on its own frame
// loop, so those state updates land outside act() by design. Drop just that
// warning: capturing its stack trace for every completion makes the suite
// crawl. A plain function, because the repo's resetMocks would wipe a spy.
const realError = console.error;

beforeAll(() => {
  // jsdom has no PointerEvent; this one carries coordinates and pointer ids.
  if (!window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends window.MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
      }
    };
  }
  console.error = (msg, ...rest) => {
    if (typeof msg === "string" && msg.includes("not wrapped in act")) return;
    realError(msg, ...rest);
  };
  MotionGlobalConfig.skipAnimations = true;
  // A plain function (not jest.fn): the repo's resetMocks would wipe it.
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
});

afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
  console.error = realError;
});

const WAIT = { timeout: 4000 };

beforeEach(() => {
  mockReduced = false;
  window.localStorage.clear();
  window.sessionStorage.clear();
  // No API in tests: saved edits "fail" to load and the shipped picks show.
  // (Without this, CRA's fetch polyfill makes a real request to localhost.)
  global.fetch = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
});

afterEach(() => {
  delete global.fetch;
});

const renderPage = () =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <TopFive />
      </MemoryRouter>
    </HelmetProvider>
  );

const openPack = (name) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name} pack`) }));

/** Rip, let the deal land, reveal the legendary: ends with the hand dealt. */
const ripAndReveal = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Rip it open/i }, WAIT));
  fireEvent.click(await screen.findByRole("button", { name: /Reveal your legendary card/i }, WAIT));
  return screen.findByRole("button", { name: /Number 1, Legendary:/ }, WAIT);
};

test("renders the shelf: eight sealed packs and an empty collection", () => {
  renderPage();
  expect(screen.getAllByRole("button", { name: /pack, sealed/ })).toHaveLength(8);
  expect(screen.getByRole("img", { name: "Collected 0 of 40 cards" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to OPS//CONSOLE" }).getAttribute("href")).toBe("/dashboard");
});

test("the full ritual: rip, deal, reveal the legendary, land in the hand", async () => {
  renderPage();
  openPack("Movies");
  expect(screen.getByRole("dialog", { name: "Movies pack" })).toBeTruthy();

  const legend = await ripAndReveal();
  expect(legend.getAttribute("aria-label")).toBe("Number 1, Legendary: Dune: Part Two");
  expect(screen.getByRole("button", { name: "Number 5, Common: The Winter Soldier" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /^Number \d/ })).toHaveLength(5);
  await waitFor(() => expect(legend).toHaveFocus(), WAIT);
});

test("inspect, flip and the escape ladder back to the shelf", async () => {
  renderPage();
  openPack("Movies");
  const legend = await ripAndReveal();

  fireEvent.click(legend);
  const flip = await screen.findByRole("button", { name: "Flip" }, WAIT);
  expect(flip.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(flip);
  expect(flip.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "f" });
  expect(flip.getAttribute("aria-pressed")).toBe("false");

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await screen.findByRole("button", { name: /Number 1, Legendary:/ }, WAIT);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), WAIT);
  expect(screen.getByRole("img", { name: "Collected 5 of 40 cards" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Movies pack, opened/ })).toBeTruthy();
});

test("opened packs persist, and re-opening one skips straight to the hand", async () => {
  const view = renderPage();
  openPack("Movies");
  await ripAndReveal();
  const stored = JSON.parse(window.localStorage.getItem("td1-opened"));
  expect(typeof stored.movies.pulledAt).toBe("string");
  view.unmount();

  renderPage();
  expect(screen.getByRole("img", { name: "Collected 5 of 40 cards" })).toBeTruthy();
  openPack("Movies");
  expect(await screen.findByRole("button", { name: /Number 1, Legendary:/ }, WAIT)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Rip it open/i })).toBeNull();
});

test("number keys jump straight to a rank, and ] switches packs", async () => {
  renderPage();
  openPack("Movies");
  await ripAndReveal();

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "3" });
  expect(await screen.findByRole("button", { name: "Flip" }, WAIT)).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await screen.findByRole("button", { name: /Number 1, Legendary:/ }, WAIT);

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "]" });
  expect(await screen.findByRole("dialog", { name: "Food pack" }, WAIT)).toBeTruthy();
  expect(await screen.findByRole("button", { name: /Rip it open/i }, WAIT)).toBeTruthy();
});

test("reduced motion opens the pack instantly, legendary already revealed", async () => {
  mockReduced = true;
  renderPage();
  openPack("Food");
  fireEvent.click(await screen.findByRole("button", { name: /Open pack/i }, WAIT));
  expect(await screen.findByRole("button", { name: "Number 1, Legendary: Neapolitan Pizza" }, WAIT)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Reveal your legendary card/i })).toBeNull();
});

test("the checklist is spoiler-safe until you ask", () => {
  renderPage();
  const checklist = screen.getByRole("region", { name: "Set checklist" });
  expect(within(checklist).getAllByText("Hidden until opened")).toHaveLength(40);
  expect(within(checklist).queryByText("Tenet")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /Spoil it for me/i }));
  expect(within(checklist).getByText("Tenet")).toBeTruthy();
  expect(within(checklist).queryAllByText("Hidden until opened")).toHaveLength(0);
});

test("the Konami code unlocks the God Pack secret rare", async () => {
  renderPage();
  const keys = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  keys.forEach((key) => fireEvent.keyDown(window, { key }));
  const secrets = screen.getByRole("region", { name: /Secret rares/ });
  await waitFor(() => expect(within(secrets).getByText("1/5")).toBeTruthy(), WAIT);
  expect(JSON.parse(window.localStorage.getItem("td1-secrets"))).toEqual(["godpack"]);
});

test("junk in storage is ignored instead of crashing the page", () => {
  window.localStorage.setItem("td1-opened", JSON.stringify({ movies: "yes", nope: { pulledAt: "x" } }));
  window.localStorage.setItem("td1-secrets", "{not json");
  renderPage();
  expect(screen.getByRole("img", { name: "Collected 0 of 40 cards" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: /pack, sealed/ })).toHaveLength(8);
});

test("the OPS//CONSOLE docks a Top 5 Things node", () => {
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );
  const node = screen.getByRole("link", { name: /Top 5 Things/ });
  expect(node.getAttribute("href")).toBe("/dashboard/top5");
});

test("revealing the legendary fires its payoff (announced to screen readers)", async () => {
  renderPage();
  openPack("Movies");
  await ripAndReveal();
  const dialog = screen.getByRole("dialog", { name: "Movies pack" });
  await waitFor(() => expect(within(dialog).getByText(/Legendary! Number 1: Dune: Part Two/)).toBeTruthy(), WAIT);
});

test("passing the pointer over the Reveal button doesn't reveal", async () => {
  renderPage();
  openPack("Movies");
  fireEvent.click(await screen.findByRole("button", { name: /Rip it open/i }, WAIT));
  const reveal = await screen.findByRole("button", { name: /Reveal your legendary card/i }, WAIT);
  fireEvent.pointerEnter(reveal);
  fireEvent.pointerLeave(reveal);
  fireEvent.pointerUp(reveal);
  expect(screen.getByRole("button", { name: /Reveal your legendary card/i })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Number 1, Legendary:/ })).toBeNull();
});

test("arrow keys still move focus after switching between opened packs", async () => {
  window.localStorage.setItem(
    "td1-opened",
    JSON.stringify({ movies: { pulledAt: "2026-09-30" }, food: { pulledAt: "2026-09-30" } })
  );
  renderPage();
  openPack("Movies");
  await screen.findByRole("button", { name: /Number 1, Legendary: Dune: Part Two/ }, WAIT);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "]" });
  await screen.findByRole("dialog", { name: "Food pack" }, WAIT);
  // wait for the outgoing hand to finish leaving
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^Number \d/ })).toHaveLength(5), WAIT);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
  expect(screen.getByRole("button", { name: "Number 2, Ultra Rare: Poutine" })).toHaveFocus();
});

const press = (el, x, y) =>
  fireEvent.pointerDown(el, { pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: y });
const release = (el, x, y) =>
  fireEvent.pointerUp(el, { pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: y });

test("a press that slips off the moving pack before release still opens it", async () => {
  renderPage();
  const pack = screen.getByRole("button", { name: /^Movies pack/ });
  // eslint-disable-next-line testing-library/no-node-access
  const cell = pack.closest("li");
  press(pack, 0, 0);
  release(cell, 2, 1); // released on the cell: the browser would click the cell, not the pack
  expect(await screen.findByRole("dialog", { name: "Movies pack" }, WAIT)).toBeTruthy();
});

test("dragging across a pack doesn't open it", () => {
  renderPage();
  const pack = screen.getByRole("button", { name: /^Movies pack/ });
  // eslint-disable-next-line testing-library/no-node-access
  const cell = pack.closest("li");
  press(pack, 0, 0);
  release(cell, 60, 0);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a keyboard press still opens a pack, once", async () => {
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: /^Movies pack/ }), { detail: 0 });
  expect(await screen.findByRole("dialog", { name: "Movies pack" }, WAIT)).toBeTruthy();
});
