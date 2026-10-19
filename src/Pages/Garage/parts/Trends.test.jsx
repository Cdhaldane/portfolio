import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import Trends from "./Trends";

beforeAll(() => {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const GOLF = { key: "golf" };

// Three running logs, only two analysed for rail droop at the reference load
// and none with a pull long enough for a charge air rise.
const LOGS = [
  { id: 3, recordedOn: "2026-10-19", filename: "datalog22.csv", catMaxC: 61, railRefDroopPct: 14.2, catRiseC: null },
  { id: 2, recordedOn: "2026-10-13", filename: "datalog20.csv", catMaxC: 55, railRefDroopPct: 4.0, catRiseC: null },
  { id: 1, recordedOn: "2026-10-08", filename: "datalog13.csv", catMaxC: 58, railRefDroopPct: null, catRiseC: null },
];

const show = (logs = LOGS) => render(<Trends car={GOLF} logs={logs} events={[]} loading={false} onOpen={() => {}} />);

test("rail droop charts the logs that have it, with its 10% warn line", () => {
  show();
  expect(screen.queryByText("warn 10%")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Rail droop" }));
  expect(screen.getByRole("heading", { name: "Rail pressure drop at reference load" })).toBeInTheDocument();
  expect(screen.getByRole("img")).toHaveAccessibleName(/^Rail pressure drop at reference load per log, 2 logs/);
  expect(screen.getByText("warn 10%")).toBeInTheDocument();
  expect(screen.getByText(/^90th percentile at full load, 4000-5500 rpm/)).toBeInTheDocument();
});

test("a metric with too few logs says why and keeps the switcher", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "CAT rise" }));
  expect(screen.getByText(/No log has this yet\. Needs two logs with a pull/)).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Peak CAT" }));
  expect(screen.getByRole("img")).toBeInTheDocument();
});

test("with no metric to chart, the whole view is the empty state", () => {
  show(LOGS.slice(0, 1));
  expect(screen.getByText("Trends need two logs with the engine running.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Metric" })).not.toBeInTheDocument();
});
