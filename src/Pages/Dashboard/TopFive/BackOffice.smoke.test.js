import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { MotionGlobalConfig } from "framer-motion";
import TopFive from "./TopFive";
import { PACKS } from "./top5.data";

// Clerk is mocked: who's signed in is decided per test.
let mockSignedIn = false;
let mockSignOuts = [];
jest.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }) => children,
  ClerkLoading: () => null,
  ClerkFailed: () => null,
  SignedIn: ({ children }) => (mockSignedIn ? children : null),
  SignedOut: ({ children }) => (mockSignedIn ? null : children),
  SignIn: () => <div>Clerk sign-in form</div>,
  useAuth: () => ({
    getToken: async () => "session-token",
    signOut: (opts) => mockSignOuts.push(opts),
    userId: "user_charlie",
  }),
}));

jest.setTimeout(20000);
const WAIT = { timeout: 4000 };
const realError = console.error;
let calls = [];

/** Route fetch by "METHOD url"; a plain function so resetMocks can't wipe it. */
const serve = (routes) => {
  global.fetch = (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers || {} });
    const route = routes[`${method} ${url}`];
    const out = route ? route(opts) : { status: 404, body: { error: "nope" } };
    // A route may return a promise, to hold a request open.
    return Promise.resolve(out).then(({ status = 200, body = {} }) => ({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }));
  };
};

const movies = PACKS[0];
const editedMovies = {
  name: "Films",
  tagline: "Now Showing",
  statLabels: [...movies.statLabels],
  cards: movies.cards.map((c, i) => (i === 0 ? { ...c, title: "Spirited Away" } : c)),
};

beforeAll(() => {
  console.error = (msg, ...rest) => {
    if (typeof msg === "string" && msg.includes("not wrapped in act")) return;
    realError(msg, ...rest);
  };
  MotionGlobalConfig.skipAnimations = true;
  process.env.REACT_APP_CLERK_PUBLISHABLE_KEY = "pk_test_placeholder";
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
});

afterAll(() => {
  console.error = realError;
  MotionGlobalConfig.skipAnimations = false;
  delete process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;
});

beforeEach(() => {
  mockSignedIn = false;
  mockSignOuts = [];
  calls = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  delete global.fetch;
});

const renderPage = () =>
  render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/dashboard/top5"]}>
        <TopFive />
      </MemoryRouter>
    </HelmetProvider>
  );

const openBackOffice = async () => {
  fireEvent.click(screen.getByRole("button", { name: /Staff only/i }));
  return screen.findByRole("dialog", { name: /Back office/i }, WAIT);
};

test("saved edits show up for every visitor", async () => {
  serve({ "GET /api/top5": () => ({ body: { ok: true, packs: { movies: editedMovies } } }) });
  renderPage();
  expect(await screen.findByRole("button", { name: /^Films pack, sealed/ }, WAIT)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Spoil it for me/i }));
  const checklist = screen.getByRole("region", { name: "Set checklist" });
  expect(within(checklist).getAllByText("Spirited Away").length).toBeGreaterThan(0);
  expect(within(checklist).queryByText("Dune: Part Two")).toBeNull();
});

test("a broken API response leaves the shipped picks alone", async () => {
  serve({ "GET /api/top5": () => ({ body: { ok: true, packs: { movies: { name: 12 } } } }) });
  renderPage();
  await waitFor(() => expect(calls.length).toBeGreaterThan(0), WAIT);
  expect(screen.getByRole("button", { name: /^Movies pack, sealed/ })).toBeTruthy();
});

test("signed-out visitors meet the staff sign-in, not the editor", async () => {
  serve({ "GET /api/top5": () => ({ body: { ok: true, packs: {} } }) });
  renderPage();
  const dialog = await openBackOffice();
  expect(within(dialog).getByText("Clerk sign-in form")).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: /Save pack/i })).toBeNull();
});

test("a signed-in stranger is turned away and shown their id", async () => {
  mockSignedIn = true;
  serve({
    "GET /api/top5": () => ({ body: { ok: true, packs: {} } }),
    "GET /api/top5?me=1": () => ({ status: 403, body: { error: "Not on the list.", userId: "user_stranger" } }),
  });
  renderPage();
  const dialog = await openBackOffice();
  expect(await within(dialog).findByText(/This shelf is Charlie's/, {}, WAIT)).toBeTruthy();
  expect(within(dialog).getByText("user_stranger")).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: /Save pack/i })).toBeNull();
});

test("the owner edits a pick, saves it, and the shelf updates", async () => {
  mockSignedIn = true;
  serve({
    "GET /api/top5": () => ({ body: { ok: true, packs: {} } }),
    "GET /api/top5?me=1": () => ({ body: { ok: true, canEdit: true } }),
    "PUT /api/top5": (opts) => ({ body: { ok: true, pack: JSON.parse(opts.body).pack } }),
  });
  renderPage();
  const dialog = await openBackOffice();
  const title = await within(dialog).findByLabelText("Title", {}, WAIT);
  expect(title.value).toBe("Dune: Part Two");

  const save = within(dialog).getByRole("button", { name: /Save pack/i });
  expect(save.disabled).toBe(true);
  fireEvent.change(title, { target: { value: "  Spirited   Away " } });
  fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Films" } });
  expect(save.disabled).toBe(false);
  fireEvent.click(save);

  await within(dialog).findByText(/Films saved/, {}, WAIT);
  const put = calls.find((c) => c.method === "PUT");
  expect(put.headers.Authorization).toBe("Bearer session-token");
  expect(put.body.packId).toBe("movies");
  expect(put.body.pack.name).toBe("Films");
  expect(put.body.pack.cards[0].title).toBe("Spirited Away");

  fireEvent.click(within(dialog).getByRole("button", { name: "Close back office" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /Back office/i })).toBeNull(), WAIT);
  expect(screen.getByRole("button", { name: /^Films pack, sealed/ })).toBeTruthy();
});

test("re-ranking moves a pick, and a blank title blocks the save", async () => {
  mockSignedIn = true;
  serve({
    "GET /api/top5": () => ({ body: { ok: true, packs: {} } }),
    "GET /api/top5?me=1": () => ({ body: { ok: true, canEdit: true } }),
  });
  renderPage();
  const dialog = await openBackOffice();
  await within(dialog).findByLabelText("Title", {}, WAIT);

  fireEvent.click(within(dialog).getByRole("button", { name: "Move #2 up" }));
  const picks = within(dialog).getAllByRole("button", { pressed: false }).filter((b) => /^#\d/.test(b.textContent));
  expect(picks[0].textContent).toMatch(/Arrival/);

  fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "   " } });
  expect(within(dialog).getByRole("button", { name: /Save pack/i }).disabled).toBe(true);
  expect(within(dialog).getByText("Title can't be empty.")).toBeTruthy();
});

test("closing with unsaved changes asks first", async () => {
  mockSignedIn = true;
  serve({
    "GET /api/top5": () => ({ body: { ok: true, packs: {} } }),
    "GET /api/top5?me=1": () => ({ body: { ok: true, canEdit: true } }),
  });
  renderPage();
  const dialog = await openBackOffice();
  fireEvent.change(await within(dialog).findByLabelText("Title", {}, WAIT), { target: { value: "Heat" } });
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(within(dialog).getByRole("alert").textContent).toMatch(/unsaved changes/i);
  fireEvent.click(within(dialog).getByRole("button", { name: "Close anyway" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /Back office/i })).toBeNull(), WAIT);
});

test("the editor won't open on top of lists that failed to load, and retry works", async () => {
  mockSignedIn = true;
  let up = false;
  serve({
    "GET /api/top5": () => (up ? { body: { ok: true, packs: {} } } : { status: 500, body: { error: "down" } }),
    "GET /api/top5?me=1": () => ({ body: { ok: true, canEdit: true } }),
  });
  renderPage();
  const dialog = await openBackOffice();
  expect(await within(dialog).findByText(/editing is paused/, {}, WAIT)).toBeTruthy();
  expect(within(dialog).queryByLabelText("Title")).toBeNull();
  up = true;
  fireEvent.click(within(dialog).getByRole("button", { name: /Try again/i }));
  expect(await within(dialog).findByLabelText("Title", {}, WAIT)).toBeTruthy();
});

test("the owner can sign out from the back office", async () => {
  mockSignedIn = true;
  serve({
    "GET /api/top5": () => ({ body: { ok: true, packs: {} } }),
    "GET /api/top5?me=1": () => ({ body: { ok: true, canEdit: true } }),
  });
  renderPage();
  const dialog = await openBackOffice();
  await within(dialog).findByLabelText("Title", {}, WAIT);
  fireEvent.click(within(dialog).getByRole("button", { name: /Sign out/i }));
  expect(mockSignOuts).toEqual([{ redirectUrl: "/dashboard/top5" }]);
});

test("a double-click can't confirm Reset; a deliberate second click does", async () => {
  mockSignedIn = true;
  serve({
    "GET /api/top5": () => ({ body: { ok: true, packs: { movies: editedMovies } } }),
    "GET /api/top5?me=1": () => ({ body: { ok: true, canEdit: true } }),
    "DELETE /api/top5?packId=movies": () => ({ body: { ok: true } }),
  });
  renderPage();
  await screen.findByRole("button", { name: /^Films pack/ }, WAIT);
  const dialog = await openBackOffice();
  const reset = await within(dialog).findByRole("button", { name: /Reset to default/i }, WAIT);
  fireEvent.click(reset, { detail: 1 });
  fireEvent.click(within(dialog).getByRole("button", { name: /Click again to reset/i }), { detail: 2 });
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: /Click again to reset/i }), { detail: 1 });
  await within(dialog).findByText(/Back to the shipped picks/, {}, WAIT);
  expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
});

test("typing during a save is kept, and only one save runs at a time", async () => {
  mockSignedIn = true;
  let finish;
  serve({
    "GET /api/top5": () => ({ body: { ok: true, packs: {} } }),
    "GET /api/top5?me=1": () => ({ body: { ok: true, canEdit: true } }),
    "PUT /api/top5": (opts) =>
      new Promise((resolve) => {
        finish = () => resolve({ body: { ok: true, pack: JSON.parse(opts.body).pack } });
      }),
  });
  renderPage();
  const dialog = await openBackOffice();
  const title = await within(dialog).findByLabelText("Title", {}, WAIT);
  fireEvent.change(title, { target: { value: "Heat" } });
  fireEvent.click(within(dialog).getByRole("button", { name: /Save pack/i }));
  fireEvent.change(title, { target: { value: "Heat (1995)" } });
  expect(within(dialog).getByRole("button", { name: /Save pack/i }).disabled).toBe(true);
  await waitFor(() => expect(typeof finish).toBe("function"), WAIT); // the PUT is in flight
  expect(within(dialog).getByText(/Restocking the shelf/)).toBeTruthy();
  finish();
  await within(dialog).findByText(/Movies saved/, {}, WAIT);
  expect(within(dialog).getByLabelText("Title").value).toBe("Heat (1995)");
  expect(within(dialog).getByRole("button", { name: /Save pack/i }).disabled).toBe(false);
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
});
