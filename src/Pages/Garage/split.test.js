import { MAX_PARTS, partName, splitCsv, splitToFit } from "./split";

const HEADER =
  'Time (sec),Engine Speed (RPM),Accel Pedal Position (%),Boost Press. (psi),(DSG)Vehicle Speed (mph),' +
  '"AP Info:[AP3-VLK-003 v1.7.6.0][USDM Volkswagen, Golf R][Reflash: Stage 2]"';

const CRUISE = { rpm: 2200, pedal: 15, boost: -5, speed: 45 };
const PULL = { rpm: 5500, pedal: 100, boost: 22, speed: 70 };
const STOP = { rpm: 800, pedal: 0, boost: -10, speed: 0 };

/** A log at 10 Hz from [[seconds, state], ...] phases. */
const drive = (phases, { eol = "\n", trailing = true } = {}) => {
  const rows = [];
  let t = 0;
  for (const [secs, s] of phases) {
    for (let k = 0; k < secs * 10; k++) {
      rows.push(`${(t / 10).toFixed(1)},${s.rpm},${s.pedal},${s.boost},${s.speed},`);
      t++;
    }
  }
  return HEADER + eol + rows.join(eol) + (trailing ? eol : "");
};

/** Every [start, end) second range a phase of `state` covers. */
const spans = (phases, state) => {
  let t = 0;
  const out = [];
  for (const [secs, s] of phases) {
    if (s === state) out.push([t, t + secs]);
    t += secs;
  }
  return out;
};

const body = (text) => text.slice(text.indexOf("\n") + 1);

const TRIP = [
  [100, CRUISE],
  [6, PULL],
  [74, CRUISE],
  [30, STOP],
  [80, CRUISE],
  [6, PULL],
  [104, CRUISE],
];

test("parts are the original header plus the original rows, byte for byte", () => {
  const text = drive(TRIP);
  const parts = splitCsv(text, 2);
  expect(parts).toHaveLength(2);
  parts.forEach((p) => expect(p.text.startsWith(HEADER + "\n")).toBe(true));
  expect(HEADER + "\n" + parts.map((p) => body(p.text)).join("")).toBe(text);
  expect(parts.reduce((n, p) => n + p.rows, 0)).toBe(4000);
});

test("the cut lands in a stop near the middle, and says so", () => {
  const parts = splitCsv(drive(TRIP), 2);
  const [stop] = spans(TRIP, STOP);
  expect(parts[0].endCut).toBe("stopped");
  expect(parts[1].endCut).toBeNull();
  expect(parts[0].endS).toBeGreaterThan(stop[0]);
  expect(parts[1].startS).toBeLessThan(stop[1]);
  expect(parts[0].startS).toBe(0);
  expect(parts[1].endS).toBeCloseTo(399.9);
});

test("with no stop it cuts while cruising, never inside a pull", () => {
  const phases = [
    [150, CRUISE],
    [8, PULL],
    [12, CRUISE],
    [8, PULL],
    [12, CRUISE],
    [8, PULL],
    [202, CRUISE],
  ];
  const parts = splitCsv(drive(phases), 2);
  expect(parts[0].endCut).toBe("cruising");
  const cutAt = parts[1].startS;
  spans(phases, PULL).forEach(([a, b]) => expect(cutAt >= a && cutAt < b).toBe(false));
});

test("a log with nothing quiet still splits evenly, flagged mid-drive", () => {
  const parts = splitCsv(drive([[400, PULL]]), 2);
  expect(parts[0].endCut).toBe("mid-drive");
  expect(parts[0].rows).toBe(2000);
});

test("CRLF endings and a missing final newline survive the split", () => {
  const text = drive(TRIP, { eol: "\r\n", trailing: false });
  const parts = splitCsv(text, 3);
  expect(parts).toHaveLength(3);
  expect(HEADER + "\r\n" + parts.map((p) => body(p.text)).join("")).toBe(text);
  expect(parts[2].text.endsWith("\r\n")).toBe(false);
  parts.slice(0, 2).forEach((p) => expect(p.text.endsWith("\r\n")).toBe(true));
});

test("refuses what it can't split", () => {
  expect(splitCsv("no newline at all", 2)).toBeNull();
  expect(splitCsv(drive([[0.2, CRUISE]]), 2)).toBeNull();
  expect(splitCsv(drive(TRIP), 1)).toBeNull();
});

test("splitToFit adds parts until each one packs under the cap", async () => {
  const text = drive(TRIP);
  // A fake gzip at 1/4 size: the whole log is ~ text.length / 4 bytes.
  const pack = async (t) => ({ b64: "x", bytes: Math.ceil(t.length / 4) });
  const cap = Math.ceil(text.length / 4 / 2.5);
  const parts = await splitToFit(text, Math.ceil(text.length / 4), pack, cap);
  expect(parts.length).toBeGreaterThanOrEqual(3);
  parts.forEach((p) => {
    expect(p.gz.bytes).toBeLessThanOrEqual(cap);
    expect(p.text).toBeUndefined();
  });
});

test("splitToFit gives up past MAX_PARTS", async () => {
  const text = drive(TRIP);
  const pack = async (t) => ({ b64: "x", bytes: t.length });
  expect(await splitToFit(text, text.length, pack, Math.ceil(text.length / (MAX_PARTS + 4)))).toBeNull();
});

test("part names keep the original and sort naturally", () => {
  expect(partName("datalog21.csv", 1, 2)).toBe("datalog21 (part 1 of 2).csv");
  expect(partName("Datalog7.CSV", 3, 3)).toBe("Datalog7 (part 3 of 3).csv");
});
