import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import LaneMode from "./LaneMode";
import { loadSeries, saveNight } from "./api";

// Clerk hands back the same getToken every render; so must the mock, or
// the load effect re-runs on every render.
const mockAuth = { getToken: async () => "token" };
jest.mock("@clerk/clerk-react", () => ({ useAuth: () => mockAuth }));
jest.mock("./api", () => ({ loadSeries: jest.fn(), saveNight: jest.fn() }));

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
