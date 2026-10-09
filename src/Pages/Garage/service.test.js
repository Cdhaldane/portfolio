import { currentOdometer, kmPerDay, lastDone, nextDue, serviceStatus, spending } from "./service";
import { addMonths, daysBetween, fmtDuration, fmtRelativeDays } from "./format";

const E = (id, happenedOn, odometerKm, services = [], costCents = null) => ({
  id,
  car: "golf",
  happenedOn,
  odometerKm,
  services,
  costCents,
});

const EVENTS = [
  E(1, "2026-09-12", 232000, ["oil", "cabin_filter"], 14999),
  E(2, "2026-09-20", 232400, [], null),
  E(3, "2026-10-04", 233100, ["tire_rotation"], 4000),
  E(4, "2025-06-01", null, ["brake_fluid"], 12000),
  E(5, "2026-10-01", null, ["plugs"]),
];

const ITEMS = [
  { key: "oil", label: "Oil", km: 8000, months: 12 },
  { key: "plugs", label: "Plugs", km: 20000 },
  { key: "brake_fluid", label: "Brake fluid", months: 24 },
  { key: "cabin_filter", label: "Cabin", months: 24 },
  { key: "tire_rotation", label: "Tires", km: 10000 },
  { key: "dsg", label: "DSG", km: 60000 },
];

test("currentOdometer is the highest reading and its day", () => {
  expect(currentOdometer(EVENTS)).toEqual({ km: 233100, date: "2026-10-04" });
  expect(currentOdometer([E(9, "2026-01-01", null)])).toBe(null);
});

test("kmPerDay needs readings two weeks apart", () => {
  expect(kmPerDay(EVENTS)).toBeCloseTo(1100 / 22);
  expect(kmPerDay(EVENTS.slice(0, 2))).toBe(null); // 8 days apart
});

test("lastDone finds the newest entry covering an item", () => {
  const later = E(6, "2026-10-05", 233200, ["oil"]);
  expect(lastDone([...EVENTS, later], "oil").id).toBe(6);
  expect(lastDone(EVENTS, "dsg")).toBe(null);
});

test("serviceStatus measures km and time, most urgent first", () => {
  const rows = serviceStatus(ITEMS, EVENTS, "2026-10-08");
  const by = Object.fromEntries(rows.map((r) => [r.item.key, r]));

  expect(by.oil.status).toBe("ok");
  expect(by.oil.dueKm).toBe(240000);
  expect(by.oil.kmLeft).toBe(6900);
  expect(by.oil.dueDate).toBe("2027-09-12");
  expect(by.oil.eta).toBe("2027-02-19"); // 6,900 km at 50 km/day = 138 days from Oct 4

  // Brake fluid: 24 months from 2025-06-01 → 2027-06-01; ok on time alone.
  expect(by.brake_fluid.status).toBe("ok");
  expect(by.brake_fluid.daysLeft).toBe(daysBetween("2026-10-08", "2027-06-01"));

  // Plugs were logged without km, and the interval is km only.
  expect(by.plugs.status).toBe("untracked");
  expect(by.dsg.status).toBe("unknown");

  expect(rows[rows.length - 1].status).toBe("unknown");
  expect(nextDue(rows).status).toBe("ok");
});

test("serviceStatus flags overdue and soon", () => {
  const rows = serviceStatus(
    [
      { key: "oil", label: "Oil", km: 8000, months: 12 },
      { key: "brake_fluid", label: "Brake fluid", months: 24 },
    ],
    [E(1, "2025-01-10", 220000, ["oil"]), E(2, "2024-10-20", null, ["brake_fluid"]), E(3, "2026-10-01", 227500)],
    "2026-10-08"
  );
  expect(rows[0].item.key).toBe("oil");
  expect(rows[0].status).toBe("overdue"); // past 12 months, and 500 km from the km limit
  expect(rows[1].status).toBe("soon"); // due 2026-10-20
  expect(rows[0].fraction).toBeGreaterThan(1);
});

test("spending totals all time and one year", () => {
  expect(spending(EVENTS, 2026)).toEqual({ all: 30999, inYear: 18999 });
});

test("format helpers", () => {
  expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  expect(addMonths("2026-09-12", 12)).toBe("2027-09-12");
  expect(fmtDuration(792)).toBe("13 min 12 s");
  expect(fmtDuration(4000)).toBe("1 h 6 min");
  expect(fmtDuration(42.3)).toBe("42 s");
  expect(fmtRelativeDays(0)).toBe("today");
  expect(fmtRelativeDays(21)).toBe("in 3 weeks");
  expect(fmtRelativeDays(-90)).toBe("3 months ago");
});
