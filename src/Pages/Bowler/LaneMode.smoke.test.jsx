import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import LaneMode from "./LaneMode";
import { loadSeries, readScreen, saveNight } from "./api";

// Clerk hands back the same getToken every render; so must the mock, or
// the load effect re-runs on every render.
const mockAuth = { getToken: async () => "token" };
jest.mock("@clerk/clerk-react", () => ({ useAuth: () => mockAuth }));
jest.mock("./api", () => ({ loadSeries: jest.fn(), saveNight: jest.fn(), readScreen: jest.fn() }));
// jsdom has no canvas or createImageBitmap; the shrink step is image.js's own business.
jest.mock("./image", () => ({
  prepareScoreboardPhoto: async () => ({ image: "AAAA", mediaType: "image/jpeg", previewUrl: "blob:screen" }),
}));

async function renderLane() {
  const view = render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/bowler/lane"]}>
        <Routes>
          <Route path="/bowler/lane" element={<LaneMode />} />
          <Route path="/bowler" element={<p>Back on the Bowler page</p>} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
  await act(async () => {}); // let the series load settle
  return view;
}

const tap = (name) => fireEvent.click(screen.getByRole("button", { name }));
const strikes = (n) => Array.from({ length: n }, () => tap("Strike"));

beforeEach(() => {
  window.localStorage.clear();
  loadSeries.mockResolvedValue({ ok: true, series: [], balls: [] });
  saveNight.mockResolvedValue({ ok: true, saved: [] });
});

test("twelve strikes is a 300 and the screen moves on to game 2", async () => {
  await renderLane();
  expect(screen.getByText("Frame 1 · ball 1")).toBeInTheDocument();
  strikes(12);
  expect(screen.getByText("Perfect. Frame that card.")).toBeInTheDocument();
  tap("Game 2");
  expect(screen.getByText("Frame 1 · ball 1")).toBeInTheDocument();
});

test("tap the pins left, then pick up the spare", async () => {
  await renderLane();
  tap("Pin 7");
  tap("Pin 10");
  expect(screen.getByText(/Leave 7-10/)).toBeInTheDocument();
  expect(screen.getByText("Split")).toBeInTheDocument();
  tap("8 down");

  expect(screen.getByText("Frame 1 · ball 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pin 1, already down" })).toBeDisabled();
  tap("Spare");
  strikes(1);
  expect(screen.getByRole("button", { name: /Re-enter frame 1: 8 \/, 20/ })).toBeInTheDocument();
});

test("undo takes back the last ball", async () => {
  await renderLane();
  strikes(1);
  expect(screen.getByText("Frame 2 · ball 1")).toBeInTheDocument();
  tap(/Undo ball/);
  expect(screen.getByText("Frame 1 · ball 1")).toBeInTheDocument();
});

test("the night in progress survives closing the app", async () => {
  const first = await renderLane();
  strikes(3);
  first.unmount();
  await renderLane();
  expect(screen.getByText("Frame 4 · ball 1")).toBeInTheDocument();
});

test("re-entering an earlier frame only changes that frame", async () => {
  await renderLane();
  strikes(2);
  tap(/Re-enter frame 1/);
  expect(screen.getByText("Re-entering frame 1")).toBeInTheDocument();
  tap("Gutter");
  tap("Miss");
  expect(screen.getByText("Frame 3 · ball 1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Re-enter frame 1: - -, 0/ })).toBeInTheDocument();
});

test("a finished night saves with its frames and heads back to the page", async () => {
  await renderLane();
  strikes(12);
  tap("Game 2");
  strikes(12);
  tap("Game 3");
  tap(/Just the score/);
  fireEvent.change(screen.getByLabelText("Charlie's game 3"), { target: { value: "187" } });
  expect(screen.getByText("Charlie 787")).toBeInTheDocument();

  await act(async () => {
    tap(/Save night/);
  });
  expect(saveNight).toHaveBeenCalledTimes(1);
  const [, payload] = saveNight.mock.calls[0];
  expect(payload.source).toBe("lane");
  expect(payload.entries).toHaveLength(1);
  expect(payload.entries[0].games).toEqual([300, 300, 187]);
  expect(payload.entries[0].frames[0]).toHaveLength(10);
  expect(payload.entries[0].frames[2]).toBeNull();
  expect(screen.getByText("Back on the Bowler page")).toBeInTheDocument();
  expect(window.localStorage.getItem("bowler-lane-v1")).toBeNull();
});

test("live help: what the game needs, and your record on the leave in front of you", async () => {
  const missedTen = { rolls: [9, 0], standing: [[10], [10]] };
  loadSeries.mockResolvedValue({
    ok: true,
    balls: [],
    series: [
      {
        id: 1,
        bowler: "cha",
        bowledOn: "2026-10-06",
        games: [90, 150, 150],
        balls: [null, null, null],
        lanes: [null, null, null],
        frames: [Array.from({ length: 10 }, () => missedTen), null, null],
      },
    ],
  });
  await renderLane();
  const needs = screen.getByRole("list", { name: "What this game needs" });
  expect(within(needs).getByText("Average 130")).toBeInTheDocument();
  expect(within(needs).getByText("131 to go")).toBeInTheDocument();
  expect(within(needs).getByText("Best game 150")).toBeInTheDocument();

  tap("Pin 10");
  tap("9 down");
  expect(screen.getByText(/Your 10 pin:/)).toBeInTheDocument();
  expect(screen.getByText("0 of 10")).toBeInTheDocument();
});

test("reading the overhead screen fills the game, and live scoring carries on", async () => {
  readScreen.mockResolvedValue({
    ok: true,
    read: {
      readable: true,
      bowlers: [
        {
          name: "CHARLIE",
          key: "cha",
          frames: Array.from({ length: 4 }, () => ({ rolls: [10], standing: null })),
          score: 60,
          complete: false,
          mismatch: false,
          problem: null,
        },
      ],
    },
  });
  await renderLane();
  const photo = new File(["x"], "screen.jpg", { type: "image/jpeg" });
  await act(async () => {
    fireEvent.change(screen.getByLabelText(/Read the screen/), { target: { files: [photo] } });
  });
  expect(screen.getByText(/through frame 4/)).toBeInTheDocument();
  expect(screen.getByLabelText("Who is CHARLIE?")).toHaveValue("cha");

  tap(/Use for game 1/);
  expect(screen.getByText("Frame 5 · ball 1")).toBeInTheDocument();
  expect(screen.getByText("From the screen: Charlie 4 frames")).toBeInTheDocument();
  strikes(1);
  expect(screen.getByText("Frame 6 · ball 1")).toBeInTheDocument();
});

test("aim & hook: mark the line on the lane and it goes with the first ball", async () => {
  await renderLane();
  tap(/Aim & hook/);
  expect(screen.getByRole("img", { name: /Your line on the lane: nothing marked yet/ })).toBeInTheDocument();

  tap("Move where you aimed one board left"); // nothing marked: starts on the 2nd arrow
  expect(screen.getByText("board 10 · 2nd arrow")).toBeInTheDocument();
  tap("Move where you aimed one board left"); // right-handed, so left is deeper
  expect(screen.getByText("board 11 · 1 left of the 2nd arrow")).toBeInTheDocument();
  tap("Move where it hooked one board right"); // starts four boards outside the aim
  expect(screen.getByText("board 7")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /aimed at board 11.*hooked at board 7/ })).toBeInTheDocument();
  tap("Hit");
  strikes(1);

  const saved = JSON.parse(window.localStorage.getItem("bowler-lane-v1")).bowlers.cha.games[0].frames[0];
  expect(saved).toMatchObject({ rolls: [10], target: 11, hook: 7, pocket: true });
  // The aim carries over to the next frame; the hook starts fresh.
  expect(screen.getByText("board 11 · 1 left of the 2nd arrow")).toBeInTheDocument();
  expect(screen.getByText("tap the lane where it turned")).toBeInTheDocument();

  tap("Lefty");
  expect(screen.getByRole("button", { name: /Lefty/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("board 11 · 1 right of the 2nd arrow")).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem("bowler-hand-v1"))).toEqual({ cha: "L" });
});

test("a failed save keeps the night on the phone", async () => {
  saveNight.mockResolvedValue({ ok: false, error: "You look offline. Try again." });
  await renderLane();
  tap(/Just the score/);
  fireEvent.change(screen.getByLabelText("Charlie's game 1"), { target: { value: "150" } });
  ["Game 2", "Game 3"].forEach((game) => {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(game) }));
    tap(/Just the score/);
    fireEvent.change(screen.getByLabelText(`Charlie's ${game.toLowerCase()}`), { target: { value: "150" } });
  });
  await act(async () => {
    tap(/Save night/);
  });
  expect(screen.getByText(/You look offline/)).toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem("bowler-lane-v1")).bowlers.cha.games[2].score).toBe("150");
});
