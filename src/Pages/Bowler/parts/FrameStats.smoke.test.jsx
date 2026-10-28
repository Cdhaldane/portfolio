import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FrameStats from "./FrameStats";
import History from "./History";
import { bowlerStats, nights } from "../stats";
import { frameStats } from "../frameStats";

jest.mock("../api", () => ({ deleteSeries: jest.fn() }));

// <Reveal> watches for scroll-in; jsdom has no IntersectionObserver.
beforeAll(() => {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const PERFECT = [
  ...Array.from({ length: 9 }, () => ({ rolls: [10], standing: [[]] })),
  { rolls: [10, 10, 10], standing: [[], [], []] },
];
const SPARES = Array.from({ length: 10 }, (_, i) =>
  i < 9 ? { rolls: [9, 1], standing: [[10], []] } : { rolls: [9, 1, 9], standing: [[10], [], [10]] }
);

const SERIES = [
  { id: 1, bowler: "cha", bowledOn: "2026-10-20", games: [300, 190, 150], frames: [PERFECT, SPARES, null], balls: [null, null, null], source: "lane" },
  { id: 2, bowler: "van", bowledOn: "2026-10-20", games: [120, 130, 140], frames: [null, null, null], balls: [null, null, null], source: "manual" },
];

const derive = (series) => ({
  frames: { cha: frameStats(series, "cha"), van: frameStats(series, "van") },
  stats: { cha: bowlerStats(series, "cha"), van: bowlerStats(series, "van") },
});

const inRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("compares the two bowlers row by row, with dashes for no frames", () => {
  inRouter(<FrameStats {...derive(SERIES)} />);
  expect(screen.getByText(/2 of 3 games tracked/)).toBeInTheDocument();
  expect(screen.getByText(/0 of 3 games tracked/)).toBeInTheDocument();

  const strikes = screen.getByRole("row", { name: /^Strikes/ });
  const [cha, van] = within(strikes).getAllByRole("cell");
  // 12 full racks in the 300, 11 in the spare game (its 10th has a fill ball).
  expect(cha).toHaveTextContent("52.2%");
  expect(cha).toHaveTextContent("12 of 23");
  expect(van).toHaveTextContent("-");

  const single = screen.getByRole("row", { name: /Single-pin spares/ });
  expect(within(single).getAllByRole("cell")[0]).toHaveTextContent("100%");

  expect(screen.getByText("Charlie's most common leaves")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Leave 10" })).toBeInTheDocument();
  expect(screen.getByText("No leaves tracked yet.")).toBeInTheDocument();
});

test("with no frames anywhere it points at the lane screen instead", () => {
  const plain = SERIES.map((r) => ({ ...r, frames: [null, null, null] }));
  inRouter(<FrameStats {...derive(plain)} />);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByRole("link", { name: /Score live/ })).toHaveAttribute("href", "/bowler/lane");
});

test("a framed night opens into its score sheets", () => {
  inRouter(
    <History
      nights={nights(SERIES)}
      ballsById={new Map()}
      getToken={jest.fn()}
      onEdit={jest.fn()}
      onWrap={jest.fn()}
      onDeleted={jest.fn()}
    />
  );
  expect(screen.getByTitle("Scored ball by ball")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Edit frames/ })).toHaveAttribute(
    "href",
    "/bowler/lane?night=2026-10-20"
  );
  fireEvent.click(screen.getByRole("button", { name: /Frames/ }));
  expect(screen.getByRole("list", { name: "Charlie, game 1: 300" })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Charlie, game 2: 190" })).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: /Vanessa/ })).toBeNull();
  expect(screen.getByText(/strikes 52% · spares 100% · 0 open\/game/)).toBeInTheDocument();
});
