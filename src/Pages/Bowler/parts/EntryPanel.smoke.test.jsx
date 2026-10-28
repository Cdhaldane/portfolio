import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import EntryPanel from "./EntryPanel";
import { saveNight } from "../api";

jest.mock("../api", () => ({ saveNight: jest.fn() }));
jest.mock("./BallPicker", () => () => null);
jest.mock("./PhotoReader", () => () => null);

const PERFECT = [
  ...Array.from({ length: 9 }, () => ({ rolls: [10], standing: [[]] })),
  { rolls: [10, 10, 10], standing: [[], [], []] },
];

const night = {
  date: "2026-10-20",
  rows: {
    cha: { id: 1, bowler: "cha", bowledOn: "2026-10-20", games: [300, 150, 160], frames: [PERFECT, null, null], balls: [null, null, null] },
    van: null,
  },
};

test("editing a night locks the framed games and leaves their frames to the server", async () => {
  saveNight.mockResolvedValue({ ok: true, saved: [] });
  const onSaved = jest.fn();
  render(
    <MemoryRouter>
      <EntryPanel
        getToken={jest.fn()}
        editing={night}
        onCancelEdit={jest.fn()}
        onSaved={onSaved}
        balls={[]}
        lastBalls={{}}
        onAddBall={jest.fn()}
      />
    </MemoryRouter>
  );

  const game1 = document.getElementById("bw-cha-0");
  const game2 = document.getElementById("bw-cha-1");
  expect(game1).toHaveValue("300");
  expect(game1).toHaveAttribute("readonly");
  expect(game2).not.toHaveAttribute("readonly");
  expect(screen.getByRole("link", { name: "Edit the frames" })).toHaveAttribute(
    "href",
    "/bowler/lane?night=2026-10-20"
  );

  fireEvent.change(game2, { target: { value: "175" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
  });
  const [, payload] = saveNight.mock.calls[0];
  expect(payload.entries).toEqual([{ bowler: "cha", games: [300, 175, 160], balls: [null, null, null] }]);
  expect(onSaved).toHaveBeenCalled();
});
