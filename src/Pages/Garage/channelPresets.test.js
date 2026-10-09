import { MAX_LANES, PRESETS, activePreset, presetCols, presetsFor } from "./channelPresets";

const ch = (key, hasData = true) => ({ key, hasData });
const all = (keys) => keys.map((k) => ch(k));
const health = PRESETS.find((p) => p.key === "health");
const dsg = PRESETS.find((p) => p.key === "dsg");

test("every preset is a full set of lanes with no repeats", () => {
  for (const p of PRESETS) {
    expect(p.lanes).toHaveLength(MAX_LANES);
    const keys = [...p.lanes, ...p.spares];
    expect(new Set(keys).size).toBe(keys.length);
  }
  expect(new Set(PRESETS.map((p) => p.key)).size).toBe(PRESETS.length);
});

test("a log with every lane gets the preset as written", () => {
  expect(presetCols(health, all([...health.spares, ...health.lanes]))).toEqual(health.lanes);
});

test("spares fill missing lanes in order, and empty channels count as missing", () => {
  const channels = [...all(health.lanes.filter((k) => k !== "afr" && k !== "rail_psi")), ch("afr", false), ...all(health.spares)];
  const cols = presetCols(health, channels);
  expect(cols).toHaveLength(MAX_LANES);
  expect(cols).not.toContain("afr");
  expect(cols.slice(-2)).toEqual(health.spares.slice(0, 2));
});

test("never more than the lane cap, even with every spare present", () => {
  for (const p of PRESETS) expect(presetCols(p, all([...p.lanes, ...p.spares])).length).toBeLessThanOrEqual(MAX_LANES);
});

test("presets missing more than half their own lanes are left out", () => {
  // An engine-only log: no DSG channels beyond the shared rpm/gear/speed.
  const keys = PRESETS.filter((p) => p.key !== "dsg").flatMap((p) => p.lanes);
  const shown = presetsFor(all(keys)).map((p) => p.key);
  expect(shown).toContain("health");
  expect(shown).not.toContain("dsg");
  expect(presetsFor(all(dsg.lanes)).map((p) => p.key)).toContain("dsg");
});

test("activePreset matches the lanes in any order, and nothing once they're edited", () => {
  const resolved = presetsFor(all(PRESETS.flatMap((p) => [...p.lanes, ...p.spares])));
  const h = resolved.find((p) => p.key === "health");
  expect(activePreset(resolved, [...h.cols].reverse())).toBe(h);
  expect(activePreset(resolved, h.cols.slice(1))).toBeNull();
});
