// Chart presets: eight lanes each, one per question you'd ask of the Golf
// (EA888 Gen 3, IS20, DQ250) after a drive. The first is what a log opens on.
//
// Keys are the API's channel keys: the canonical name for a mapped Cobb header
// (COBB_TO_CANON in api/_lib/telemetry-analyze.js), the raw header for the
// rest, and kr_max for the derived worst-cylinder knock lane. `lanes` is the
// preset; `spares` stand in, in order, for any lane a log didn't record, so a
// different Accessport logging profile still fills all eight.

export const MAX_LANES = 8; // the API serves at most 8 (MAX_SERIES_COLS)

export const PRESETS = [
  {
    key: "health",
    label: "Health check",
    icon: "fa-heart-pulse",
    about: "One lane per automated check, with rpm and pedal for context. Start here, then open the preset for whatever it flags.",
    lanes: ["rpm", "pedal_pct", "boost_psi", "kr_max", "cat_c", "ltft_pct", "rail_psi", "afr"],
    spares: ["afr_sp", "timing_deg", "torque_ftlb", "speed_mph"],
  },
  {
    key: "knock",
    label: "Knock",
    icon: "fa-bolt",
    about: "Knock retard per cylinder against boost and final timing. Retard on one cylinder points at that cylinder (plug, coil); on all four, at fuel or heat.",
    lanes: [
      "rpm",
      "boost_psi",
      "timing_deg",
      "COBB Spark Reduction (Degrees)",
      "kr_cyl1",
      "kr_cyl2",
      "kr_cyl3",
      "kr_cyl4",
    ],
    spares: ["kr_max", "cat_c", "pedal_pct"],
  },
  {
    key: "boost",
    label: "Boost",
    icon: "fa-wind",
    about: "Pressure upstream of the throttle and air mass against their set points, with the wastegate actuator. Falling short while the actuator is near its limit suggests a boost leak or a turbo at its limit.",
    lanes: [
      "rpm",
      "pedal_pct",
      "put_psia",
      "put_sp_psia",
      "boost_psi",
      "Turbine Act. Final Value (%)",
      "Air Mass IM Per Stroke (mg/stk)",
      "Air Mass Per Stroke SP (mg/stk)",
    ],
    spares: ["Wastegate Mass Flow SP (g/s)", "throttle_pct", "map_kpa", "maf_gs", "cat_c"],
  },
  {
    key: "fuel",
    label: "Fuel",
    icon: "fa-gas-pump",
    about: "Rail pressure against its set point with the high-pressure pump's effective volume, then AFR against target and both trims. Rail pressure sagging as the pump nears 100% is an HPFP at its limit.",
    lanes: [
      "rpm",
      "rail_psi",
      "rail_sp_psi",
      "HPFP Effective Pump Vol (%)",
      "afr",
      "afr_sp",
      "stft_pct",
      "ltft_pct",
    ],
    spares: ["Injection Time Primary Pulse Average (us)", "pedal_pct", "boost_psi"],
  },
  {
    key: "heat",
    label: "Heat soak",
    icon: "fa-temperature-high",
    about: "Charge air temperature against road speed, with the timing and knock it costs. Watch for timing falling away as charge air climbs over back-to-back pulls.",
    lanes: ["rpm", "speed_mph", "cat_c", "iat_c", "coolant_c", "oil_c", "timing_deg", "kr_max"],
    spares: ["torque_ftlb", "boost_psi", "pedal_pct"],
  },
  {
    key: "torque",
    label: "Torque limits",
    icon: "fa-gauge-high",
    about: "Torque delivered against the ECU's air-mass target and its engine and clutch ceilings. When delivered falls short, the limitation source shows which limiter was in charge.",
    lanes: [
      "rpm",
      "pedal_pct",
      "torque_ftlb",
      "Trq Value Air Mass SP (ft-lb)",
      "Torque Maximum Engine (ft-lb)",
      "Torque Maximum Clutch (ft-lb)",
      "Torque Limitation Source (-)",
      "(DSG)Torque Reduction Active ()",
    ],
    spares: ["Maximum Torque at Clutch (ft-lb)", "(DSG)Engine Torque (ft-lb)", "gear"],
  },
  {
    key: "dsg",
    label: "DSG",
    icon: "fa-gears",
    about: "Clutch 1 (odd gears) slip against engine torque, with line and clutch 2 pressure. Slip that grows under load is a clutch near its limit.",
    lanes: [
      "rpm",
      "gear",
      "(DSG)Target Gear (Gear)",
      "(DSG)Clutch 1 Slip (RPM)",
      "(DSG)Engine Torque (ft-lb)",
      "(DSG)Clutch 2 Pressure (psi)",
      "(DSG)Line Pressure Set Point (psi)",
      "speed_mph",
    ],
    spares: [
      "(DSG)Clutch 1 Solenoid Duty Cycle (%)",
      "(DSG)Clutch 2 Solenoid Duty Cycle (%)",
      "(DSG)Line Pressure Solenoid Duty Cycle (%)",
      "pedal_pct",
    ],
  },
];

export const DEFAULT_PRESET = PRESETS[0];

/** The preset's lanes this log has data for, topped up from its spares. */
export function presetCols(preset, channels) {
  const have = new Set(channels.filter((c) => c.hasData).map((c) => c.key));
  const lanes = preset.lanes.filter((k) => have.has(k));
  const spares = preset.spares.filter((k) => have.has(k) && !lanes.includes(k));
  return [...lanes, ...spares].slice(0, MAX_LANES);
}

/**
 * Every preset resolved against one log's channels, leaving out any that's
 * missing more than half its own lanes: spares fill gaps, they can't stand in
 * for the point of the preset (a DSG view of a log with no DSG channels).
 */
export function presetsFor(channels) {
  const have = new Set(channels.filter((c) => c.hasData).map((c) => c.key));
  return PRESETS.filter((p) => p.lanes.filter((k) => have.has(k)).length * 2 >= p.lanes.length).map((p) => ({
    ...p,
    cols: presetCols(p, channels),
  }));
}

/** The preset showing exactly these lanes, in any order, or null once they've been edited. */
export function activePreset(resolved, cols) {
  return (
    resolved.find((p) => p.cols.length === cols.length && p.cols.every((k) => cols.includes(k))) || null
  );
}
