import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { uploadLog } from "../api";
import { MAX_GZ_BYTES, gzipFile } from "../upload";
import Uploader from "./Uploader";

jest.mock("../api", () => ({ uploadLog: jest.fn() }));
// jsdom has no CompressionStream: pretend each byte gzips to 80, so a small
// log reads as one too big to send whole while its halves fit.
const SCALE = 80;
jest.mock("../upload", () => ({
  ...jest.requireActual("../upload"),
  canCompress: () => true,
  gzipFile: jest.fn(),
}));

const HEADER = "Time (sec),Accel Pedal Position (%),Boost Press. (psi),(DSG)Vehicle Speed (mph)";

/** 10 Hz: cruise, a stop in the middle, cruise. */
const bigLog = () => {
  const rows = [];
  for (let k = 0; k < 4000; k++) {
    const stopped = k >= 1800 && k < 2200;
    rows.push(`${(k / 10).toFixed(1)},${stopped ? 0 : 15},${stopped ? -10 : -5},${stopped ? 0 : 45}`);
  }
  return `${HEADER}\n${rows.join("\n")}\n`;
};

const drop = (text, name) => {
  const file = new File([text], name, { type: "text/csv", lastModified: Date.parse("2026-10-19T12:00:00") });
  file.text = async () => text; // jsdom 16's File has no text()
  const input = screen.getByLabelText(/choose files/);
  fireEvent.change(input, { target: { files: [file] } });
};

// CRA resets mocks before every test, so implementations go here.
beforeEach(() => {
  gzipFile.mockImplementation(async (blob) => ({ b64: "QUJD", bytes: blob.size * SCALE }));
  uploadLog.mockResolvedValue({
    ok: true,
    preview: { durationS: 200, samples: 2000, source: "cobb", findings: [], worstLevel: "ok" },
    duplicateOf: null,
  });
});

test("a log too big to send whole is staged as parts, each checked on its own", async () => {
  const text = bigLog();
  expect(text.length * SCALE).toBeGreaterThan(MAX_GZ_BYTES);

  render(<Uploader getToken={async () => "t"} car="golf" onSaved={() => {}} />);
  drop(text, "datalog21.csv");

  expect(await screen.findByRole("button", { name: "Remove datalog21 (part 1 of 2).csv" })).not.toBeNull();
  expect(screen.getByRole("button", { name: "Remove datalog21 (part 2 of 2).csv" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Remove datalog21.csv" })).toBeNull();
  expect(screen.getByText(/Part 1 of 2 of datalog21\.csv · 0:00–3:\d\d, cut while stopped/)).not.toBeNull();

  await waitFor(() => expect(uploadLog).toHaveBeenCalledTimes(2));
  const calls = uploadLog.mock.calls.map(([, body]) => body);
  expect(calls.map((b) => b.filename)).toEqual(["datalog21 (part 1 of 2).csv", "datalog21 (part 2 of 2).csv"]);
  calls.forEach((b) => expect(b.commit).toBe(false));
  expect(await screen.findByRole("button", { name: /Save 2 logs/ })).not.toBeNull();
});

test("a log that fits is sent whole", async () => {
  render(<Uploader getToken={async () => "t"} car="golf" onSaved={() => {}} />);
  drop(`${HEADER}\n0,15,-5,45\n0.1,15,-5,45\n`, "datalog3.csv");
  await waitFor(() => expect(uploadLog).toHaveBeenCalledTimes(1));
  expect(uploadLog.mock.calls[0][1].filename).toBe("datalog3.csv");
  expect(screen.queryByText(/part 1 of/)).toBeNull();
});
