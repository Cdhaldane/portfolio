import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import EngineInsights from "./EngineInsights";
// mqbtel's own summary of a synthetic 1st-2nd-3rd pull (make_goldens.py), so
// the component is tested against the exact shape the API stores.
import golden from "../../../../api/_lib/__fixtures__/telemetry/insights_pull.expected.json";

beforeAll(() => {
  window.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const captions = () => screen.getAllByRole("figure").map((f) => within(f).getByText(/rpm|@|median|peak|–/).textContent);

test("draws the four curves for the pull, led by its peaks", () => {
  render(<EngineInsights summary={golden} />);
  expect(screen.getAllByRole("figure")).toHaveLength(4);
  expect(screen.getByText(/hp @ 6,000$/)).toBeInTheDocument();
  expect(screen.getByText(/^median \d+\.\d°$/)).toBeInTheDocument();
  expect(screen.getByText("peak 141 °C")).toBeInTheDocument();
});

test("one hover moves the cursor on every chart", () => {
  render(<EngineInsights summary={golden} />);
  const [first] = screen.getAllByRole("img");
  fireEvent.pointerMove(first, { clientX: 0, pointerType: "mouse" });
  const bands = captions().map((c) => c.split(" · ")[0]);
  expect(new Set(bands).size).toBe(1);
  expect(bands[0]).toMatch(/^\d,\d{3}–\d,\d{3} rpm$/);
});

test("headroom meters, with the fuel pump at capacity marked watch", () => {
  render(<EngineInsights summary={golden} />);
  const meters = screen.getAllByRole("meter");
  expect(meters.map((m) => m.getAttribute("aria-label"))).toEqual([
    "Fuel pump",
    "Airflow",
    "Torque vs ceiling",
    "On a torque limiter",
  ]);
  expect(meters[0]).toHaveAttribute("aria-valuenow", "100");
  expect(meters[1]).toHaveAttribute("aria-valuenow", "83");
  const pump = meters[0].closest("li");
  expect(within(pump).getByText("Watch")).toBeInTheDocument();
});

test("lists upshifts under load with their handover times", () => {
  render(<EngineInsights summary={golden} />);
  const rows = screen.getByRole("columnheader", { name: "Shift" }).closest("table").querySelectorAll("tbody tr");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("1→2");
  expect(rows[0]).toHaveTextContent("in pull");
  expect(rows[0]).toHaveTextContent("0.80 s");
  expect(screen.getByText("Clutch 1 slip").nextSibling).toHaveTextContent("12 rpm");
});

test("a second pull adds a picker and stays as grey context", () => {
  const second = { ...golden.pulls[0], start_s: 30, end_s: 34, peak_hp: 380, peak_hp_rpm: 5500 };
  const { container } = render(<EngineInsights summary={{ ...golden, pulls: [...golden.pulls, second] }} />);
  const picker = screen.getByRole("group", { name: "Pull in focus" });
  expect(within(picker).getAllByRole("button")).toHaveLength(2);
  expect(within(picker).getByRole("button", { pressed: true })).toHaveTextContent("Pull 1");
  expect(container.querySelectorAll(".gr-ins-ghost")).toHaveLength(4);
  fireEvent.click(within(picker).getByRole("button", { name: /Pull 2/ }));
  expect(screen.getByText("380 hp @ 5,500")).toBeInTheDocument();
});

test("a summary from before the insights renders nothing", () => {
  const old = { ...golden, shifts: undefined, pulls: golden.pulls.map(({ curve, ...p }) => p) };
  const { container } = render(<EngineInsights summary={old} />);
  expect(container).toBeEmptyDOMElement();
});
