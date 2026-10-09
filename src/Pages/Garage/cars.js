// The two cars. Keys match the API's stored ids (tel_logs.car, tel_events.car).
//
// `service` is the maintenance schedule the Service tab tracks. A work-log
// entry "covers" an item when its services list holds the item's key, and the
// next due point is that entry's km/date plus the interval (whichever comes
// first). The intervals are starting points, not gospel: VW/Porsche schedules
// tightened where a tuned or high-mileage car is usually serviced sooner.
// Check them against the owner's manual and your tuner, then edit them here.
// Per-car profiles move to a tel_cars table once mass/gearing arrive.

export const CARS = [
  {
    key: "golf",
    name: "Golf R",
    year: 2017,
    make: "Volkswagen",
    chassis: "Mk7",
    specs: ["EA888 Gen 3 CYFB", "IS20 turbo", "DQ250 6-speed DSG", "Simos18"],
    // Fallback only: the hero shows the maps the latest Accessport log reports.
    tune: { ecu: "EQT Stage 2 91 v2.52", tcm: "EQT DSG Stage 2 14Q v2.50" },
    loggers: "Cobb Accessport V3 + AndrOBD",
    service: [
      { key: "oil", label: "Engine oil + filter", km: 8000, months: 12 },
      { key: "plugs", label: "Spark plugs", km: 20000 },
      { key: "dsg", label: "DSG fluid + filter", km: 60000 },
      { key: "haldex", label: "Haldex fluid", km: 50000, months: 36 },
      { key: "rear_diff", label: "Rear diff fluid", km: 60000 },
      { key: "brake_fluid", label: "Brake fluid", months: 24 },
      { key: "air_filter", label: "Engine air filter", km: 30000 },
      { key: "cabin_filter", label: "Cabin filter", months: 24 },
      { key: "tire_rotation", label: "Tire rotation", km: 10000 },
    ],
  },
  {
    key: "cayenne",
    name: "Cayenne S",
    year: 2009,
    make: "Porsche",
    chassis: "957",
    specs: ["4.8 V8 DFI", "6-speed Tiptronic S"],
    tune: null,
    loggers: "AndrOBD",
    service: [
      { key: "oil", label: "Engine oil + filter", km: 10000, months: 12 },
      { key: "plugs", label: "Spark plugs", km: 60000, months: 48 },
      { key: "trans", label: "Transmission fluid", km: 80000 },
      { key: "transfer_case", label: "Transfer case fluid", km: 60000 },
      { key: "diffs", label: "Front + rear diff fluid", km: 80000 },
      { key: "brake_fluid", label: "Brake fluid", months: 24 },
      { key: "air_filter", label: "Engine air filters", km: 40000, months: 48 },
      { key: "cabin_filter", label: "Cabin filter", km: 20000, months: 24 },
      { key: "tire_rotation", label: "Tire rotation", km: 10000 },
    ],
  },
];

export const CAR_BY_KEY = Object.fromEntries(CARS.map((c) => [c.key, c]));

// Work-log entry kinds, in the order the form offers them. Keys match the API.
export const KINDS = [
  { key: "service", label: "Service", icon: "fa-oil-can" },
  { key: "repair", label: "Repair", icon: "fa-wrench" },
  { key: "mod", label: "Mod", icon: "fa-bolt" },
  { key: "inspection", label: "Inspection", icon: "fa-magnifying-glass" },
  { key: "reading", label: "Odometer", icon: "fa-gauge" },
  { key: "other", label: "Other", icon: "fa-note-sticky" },
];

export const KIND_BY_KEY = Object.fromEntries(KINDS.map((k) => [k.key, k]));

// Status levels from the analysis, worst first.
export const LEVELS = {
  warn: { label: "Warn", icon: "fa-triangle-exclamation" },
  watch: { label: "Watch", icon: "fa-eye" },
  info: { label: "Info", icon: "fa-circle-info" },
  ok: { label: "OK", icon: "fa-check" },
};

export const LEVEL_RANK = { info: 0, ok: 1, watch: 2, warn: 3 };

// Mirrors the analysis thresholds (api/_lib/telemetry-analyze.js), for
// colouring list cells and drawing bands on the trend charts.
export const THRESHOLDS = {
  catMaxC: { watch: 70, warn: 90 },
  knockMaxDeg: { watch: 0, warn: 3 },
  ltftMeanPct: { watch: 5, warn: 10 },
};

export const HEURISTICS_CAVEAT =
  "Heuristics tuned for a Stage 2 IS20 on pump fuel. Prompts to look closer, not a diagnosis.";

/** Today's date (YYYY-MM-DD) where the cars live. */
export const todayLocal = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
