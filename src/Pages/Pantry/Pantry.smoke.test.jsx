import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import Pantry from "./Pantry";
import Kitchen from "./Kitchen";
import * as api from "./api";

// Clerk hands back the same getToken every render; so must the mock, or
// the load effect re-runs on every render.
const mockAuth = { getToken: async () => "token" };
jest.mock("@clerk/clerk-react", () => ({ useAuth: () => mockAuth, UserButton: () => null }));
jest.mock("./api");
// jsdom can't decode images; the flow only needs the prepared result.
jest.mock("./image", () => ({
  prepareReceiptPhoto: async (file) => ({ image: "QUFBQQ==", mediaType: "image/jpeg", previewUrl: `blob:${file.name}` }),
}));
// Zero-length transitions, so tab swaps and sheets settle at once.
jest.mock("framer-motion", () => ({ ...jest.requireActual("framer-motion"), useReducedMotion: () => true }));

const today = "2026-11-04";
const status = (over = {}) => ({
  state: "ok",
  cadence: null,
  dueOn: null,
  useBy: null,
  useSoon: false,
  expired: false,
  stale: false,
  staple: false,
  onList: false,
  ...over,
});
const item = (over) => ({
  category: "other",
  location: "pantry",
  qty: 1,
  lowAt: 0.25,
  staple: null,
  shelfDays: null,
  lastBoughtOn: "2026-10-28",
  countedOn: null,
  snoozeUntil: null,
  archived: false,
  purchases: [],
  unitCents: null,
  ...over,
  status: status(over.status),
});

const ITEMS = [
  item({ id: 5, name: "Bread", location: "counter", status: { state: "due", cadence: 7, dueOn: today, onList: true } }),
  item({ id: 2, name: "Eggs", location: "fridge", qty: 0.25, unitCents: 429, status: { state: "low", onList: true } }),
  item({ id: 1, name: "Milk 2%", location: "fridge", qty: 0, unitCents: 649, status: { state: "out", onList: true, staple: true } }),
  item({ id: 4, name: "Rice", qty: 3 }),
  item({ id: 3, name: "Spinach", location: "fridge", qty: 1, status: { useSoon: true, useBy: "2026-11-05" } }),
];

const DATA = {
  today,
  items: ITEMS,
  extras: [{ id: 9, name: "Birthday candles" }],
  receipts: [{ id: 7, store: "No Frills", purchasedOn: "2026-10-28", totalCents: 4512, lineCount: 12 }],
  recipes: {
    at: "2026-11-04T21:00:00Z",
    ask: "",
    recipes: [
      {
        title: "Spinach and egg fried rice",
        blurb: "Uses the spinach before it turns.",
        minutes: 20,
        servings: 2,
        uses: [
          { itemId: 3, amount: "1 bag" },
          { itemId: 4, amount: "2 cups" },
          { itemId: 2, amount: "2" },
        ],
        missing: ["Green onions"],
        steps: ["Cook the rice.", "Fry it all together."],
        tags: ["one pan"],
      },
    ],
  },
  push: { enabled: false, publicKey: null },
  kitchen: { path: "/pantry/kitchen?k=secret" },
};

async function renderAt(path) {
  const view = render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/pantry/kitchen" element={<Kitchen />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
  await act(async () => {}); // let the load settle
  return view;
}

const tap = (name) => fireEvent.click(screen.getByRole("button", { name }));

beforeAll(() => {
  window.scrollTo = jest.fn();
  URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  api.loadPantry.mockResolvedValue({ ok: true, data: DATA });
});

test("the shelf groups by where things live and flags what needs attention", async () => {
  await renderAt("/pantry");
  const fridge = screen.getByRole("region", { name: /Fridge/ });
  expect(within(fridge).getByText("Milk 2%")).toBeInTheDocument();
  expect(within(fridge).getByText("Out")).toBeInTheDocument();
  expect(within(fridge).getByText("Low")).toBeInTheDocument();
  expect(within(fridge).getByText("Use soon")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: /Counter/ })).toHaveTextContent("Due");
  // The glance row: 1 out, 2 low or due, 1 use soon.
  expect(screen.getByRole("button", { name: /1\s*out/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /2\s*low or due/ })).toBeInTheDocument();
  // List badge counts derived items plus the typed-in extra.
  expect(screen.getByRole("button", { name: /List/ })).toHaveTextContent("4");
});

test("the row's minus steps whole packs above one and quarters below", async () => {
  api.adjust.mockResolvedValue({ ok: true, item: { ...ITEMS[3], qty: 2 } });
  await renderAt("/pantry");
  tap("Used some Rice");
  await act(async () => {});
  expect(api.adjust).toHaveBeenCalledWith(mockAuth.getToken, 4, "use", 1);

  api.adjust.mockResolvedValue({
    ok: true,
    item: { ...ITEMS[4], qty: 0.75, status: status({ useSoon: true, useBy: "2026-11-05" }) },
  });
  tap("Used some Spinach");
  await act(async () => {});
  expect(api.adjust).toHaveBeenLastCalledWith(mockAuth.getToken, 3, "use", 0.25);
});

test("the list builds itself and 'got it' counts as buying one", async () => {
  api.adjust.mockResolvedValue({ ok: true, item: { ...ITEMS[2], qty: 1, status: status() } });
  await renderAt("/pantry?tab=list");
  expect(await screen.findByText("4 things to get")).toBeInTheDocument();
  expect(screen.getByText("About $10.78 for the 2 with a price")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Probably due/ })).toBeInTheDocument();
  expect(screen.getByText("Birthday candles")).toBeInTheDocument();
  tap("Got Milk 2%");
  await act(async () => {});
  expect(api.adjust).toHaveBeenCalledWith(mockAuth.getToken, 1, "add", 1);
  expect(await screen.findByText("Got Milk 2%.")).toBeInTheDocument();
});

test("a receipt goes photo → Claude's read → review → saved", async () => {
  api.readReceipt.mockResolvedValue({
    ok: true,
    read: {
      store: "No Frills",
      purchasedOn: "2026-11-03",
      totalCents: 1312,
      lines: [
        { raw: "NN 2% MLK 4L", name: "Milk 2%", matchId: 1, matchName: "Milk 2%", category: "dairy", location: "fridge", qty: 1, size: "4 L", priceCents: 649, shelfDays: 10, keep: true },
        { raw: "AVOCADO", name: "Avocados", matchId: null, matchName: null, category: "produce", location: "counter", qty: 2, size: null, priceCents: 600, shelfDays: 4, keep: true },
        { raw: "BAG FEE", name: "Bag", matchId: null, matchName: null, category: "other", location: "pantry", qty: 1, size: null, priceCents: 10, shelfDays: null, keep: false },
      ],
    },
  });
  api.saveReceipt.mockResolvedValue({
    ok: true,
    data: { ...DATA, saved: { receiptId: 8, restocked: 1, added: 1, listCleared: 1 } },
  });
  await renderAt("/pantry");
  tap("Scan a receipt");
  const dialog = screen.getByRole("dialog", { name: "Scan a receipt" });
  const input = dialog.querySelector('input[type="file"]');
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(["x"], "top.jpg", { type: "image/jpeg" })] } });
  });
  expect(within(dialog).getByAltText("Receipt, part 1")).toBeInTheDocument();
  await act(async () => tap("Read the receipt"));
  expect(api.readReceipt).toHaveBeenCalledWith(mockAuth.getToken, [{ image: "QUFBQQ==", mediaType: "image/jpeg" }]);

  const review = screen.getByRole("dialog", { name: "Check what Claude read" });
  expect(within(review).getByText("1 restock · 1 new")).toBeInTheDocument();
  expect(within(review).getByText("Have none now → 1")).toBeInTheDocument();
  expect(within(review).getByText(/1 line left out/)).toBeInTheDocument();
  await act(async () => tap("Add 2 to the pantry"));
  const sent = api.saveReceipt.mock.calls[0][1];
  expect(sent).toMatchObject({ store: "No Frills", purchasedOn: "2026-11-03", totalCents: 1312, force: false });
  expect(sent.lines.map((l) => [l.itemId, l.name, l.qty])).toEqual([
    [1, "Milk 2%", 1],
    [null, "Avocados", 2],
  ]);
  expect(screen.getByText("Pantry updated")).toBeInTheDocument();
  expect(screen.getByText("1 restocked · 1 new on the shelf · 1 off the list")).toBeInTheDocument();
});

test("a duplicate receipt asks before adding it again", async () => {
  api.saveReceipt
    .mockResolvedValueOnce({ ok: false, code: "duplicate", data: { purchasedOn: "2026-10-28" }, error: "dupe" })
    .mockResolvedValueOnce({ ok: true, data: { ...DATA, saved: { receiptId: 9, restocked: 0, added: 1, listCleared: 0 } } });
  await renderAt("/pantry");
  tap("Scan a receipt");
  tap("or type it in yourself");
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Coffee beans" } });
  await act(async () => tap("Add 1 to the pantry"));
  expect(screen.getByText(/looks like the receipt you added for/)).toBeInTheDocument();
  await act(async () => tap("Add it again"));
  expect(api.saveReceipt.mock.calls[1][1].force).toBe(true);
  expect(screen.getByText("Pantry updated")).toBeInTheDocument();
});

test("after cooking, only what ran low or out is written", async () => {
  api.cooked.mockResolvedValue({ ok: true, items: [{ ...ITEMS[4], qty: 0, status: status({ state: "out", onList: true }) }] });
  await renderAt("/pantry?tab=cook");
  expect(await screen.findByText("Spinach and egg fried rice")).toBeInTheDocument();
  tap("We made this");
  const sheet = screen.getByRole("dialog", { name: "What did it use up?" });
  fireEvent.click(within(within(sheet).getByRole("radiogroup", { name: "Spinach" })).getByRole("radio", { name: "All gone" }));
  fireEvent.click(within(within(sheet).getByRole("radiogroup", { name: "Eggs" })).getByRole("radio", { name: "Running low" }));
  await act(async () => fireEvent.click(within(sheet).getByRole("button", { name: "Done" })));
  expect(api.cooked).toHaveBeenCalledWith(mockAuth.getToken, [
    { id: 3, op: "out" },
    { id: 4, op: "plenty" },
    { id: 2, op: "low" },
  ]);
});

test("the kitchen display reads the token feed", async () => {
  api.loadKitchen.mockResolvedValue({
    ok: true,
    data: {
      today,
      out: [{ id: 1, name: "Milk 2%" }],
      low: [{ id: 2, name: "Eggs" }],
      useSoon: [{ id: 3, name: "Spinach" }],
      extras: ["Birthday candles"],
      say: "You're out of milk 2%. Running low on eggs.",
    },
  });
  await renderAt("/pantry/kitchen?k=secret");
  expect(api.loadKitchen).toHaveBeenCalledWith("secret");
  expect(screen.getByText("You're out of milk 2%. Running low on eggs.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /Running low/ })).toBeInTheDocument();
  expect(screen.getByText("Birthday candles")).toBeInTheDocument();
});

test("the kitchen display without a token says so instead of calling home", async () => {
  await renderAt("/pantry/kitchen");
  expect(api.loadKitchen).not.toHaveBeenCalled();
  expect(screen.getByText(/This kitchen link isn't right/)).toBeInTheDocument();
});
