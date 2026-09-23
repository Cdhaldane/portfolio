import { useEffect, useState } from "react";
import { saveNight } from "../api";
import { BOWLERS, GAMES, MAX_GAME, formatNight, todayLocal } from "../bowlers";
import PhotoReader from "./PhotoReader";
import "./EntryPanel.css";

/*
 * Add or edit one league night. Two ways in (photo read or typing), one
 * review form out: the photo path only PREFILLS the same inputs, so a
 * misread is a keystroke to fix and nothing is saved without a look.
 */
const blankRow = () => ({ include: true, games: Array(GAMES).fill("") });

const blankForm = () => ({
  bowledOn: todayLocal(),
  note: "",
  source: "manual",
  rows: Object.fromEntries(BOWLERS.map((b) => [b.key, blankRow()])),
});

const formFromNight = (night) => ({
  bowledOn: night.date,
  note: (night.rows.cha || night.rows.van || {}).note || "",
  source: "manual",
  rows: Object.fromEntries(
    BOWLERS.map(({ key }) => {
      const row = night.rows[key];
      return [
        key,
        row ? { include: true, games: row.games.map(String) } : { ...blankRow(), include: false },
      ];
    })
  ),
});

const parseGame = (v) => (v === "" ? NaN : Number(v));
const validGame = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_GAME;

function validate(form) {
  if (!form.bowledOn) return "Pick the league night date.";
  const included = BOWLERS.filter(({ key }) => form.rows[key].include);
  if (!included.length) return "Include at least one bowler.";
  const bad = included.find(({ key }) => !form.rows[key].games.map(parseGame).every(validGame));
  return bad ? `${bad.name} needs three games, each 0 to ${MAX_GAME}.` : null;
}

const seriesSum = (games) => {
  const nums = games.map(parseGame);
  return nums.every(validGame) ? nums.reduce((a, b) => a + b, 0) : null;
};

const EntryPanel = ({ getToken, editing, onCancelEdit, onSaved }) => {
  const [mode, setMode] = useState("photo");
  const [visionOff, setVisionOff] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [extras, setExtras] = useState([]); // other rows the photo found
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setForm(formFromNight(editing));
      setExtras([]);
      setError(null);
      setMode("type");
    }
  }, [editing]);

  const setRow = (key, patch) =>
    setForm((f) => ({ ...f, rows: { ...f.rows, [key]: { ...f.rows[key], ...patch } } }));

  const setGame = (key, i, value) => {
    const clean = value.replace(/\D/g, "").slice(0, 3);
    setForm((f) => ({
      ...f,
      rows: {
        ...f.rows,
        [key]: { ...f.rows[key], games: f.rows[key].games.map((g, j) => (j === i ? clean : g)) },
      },
    }));
  };

  const assignRow = (key, row) =>
    setRow(key, { include: true, games: row.games.map((g) => (g === null ? "" : String(g))) });

  const onRead = (read) => {
    const next = { ...form, source: "photo", rows: { ...form.rows } };
    BOWLERS.forEach(({ key }) => {
      const hit = read.bowlers.find((r) => r.key === key);
      next.rows[key] = hit
        ? { include: true, games: hit.games.map((g) => (g === null ? "" : String(g))) }
        : { ...blankRow(), include: false };
    });
    setForm(next);
    setExtras(read.bowlers.filter((r) => !r.key || r.mismatch));
    setError(null);
  };

  const reset = () => {
    setForm(blankForm());
    setExtras([]);
    setError(null);
    onCancelEdit();
  };

  async function submit(e) {
    e.preventDefault();
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await saveNight(getToken, {
      bowledOn: form.bowledOn,
      note: form.note,
      source: form.source,
      entries: BOWLERS.filter(({ key }) => form.rows[key].include).map(({ key }) => ({
        bowler: key,
        games: form.rows[key].games.map(Number),
      })),
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setForm(blankForm());
    setExtras([]);
    onSaved();
  }

  const mismatched = extras.filter((r) => r.key && r.mismatch);
  const strangers = extras.filter((r) => !r.key);

  return (
    <section className="bw-entry" aria-labelledby="bw-entry-title">
      <div className="bw-entry-head">
        <h2 id="bw-entry-title" className="bw-h2">
          {editing ? `Editing ${formatNight(editing.date)}` : "Tonight's scores"}
        </h2>
        {!editing && (
          <div className="bw-tabs" role="tablist" aria-label="How to add scores">
            {[
              ["photo", "fa-camera", "Photo"],
              ["type", "fa-keyboard", "Type it"],
            ].map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={`bw-tab ${mode === id ? "is-on" : ""}`}
                onClick={() => setMode(id)}
              >
                <i className={`fa-solid ${icon}`} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`bw-entry-body ${mode === "photo" && !editing ? "has-photo" : ""}`}>
        {mode === "photo" && !editing && (
          <div>
            {visionOff ? (
              <p className="bw-photo-note">
                Photo reading isn't switched on for this site yet, so type the scores in instead.
              </p>
            ) : (
              <PhotoReader
                getToken={getToken}
                onRead={onRead}
                onUnavailable={() => setVisionOff(true)}
              />
            )}
          </div>
        )}

        <form className="bw-form" onSubmit={submit} noValidate>
          <div className="bw-field bw-field--date">
            <label htmlFor="bw-date">League night</label>
            <input
              id="bw-date"
              type="date"
              value={form.bowledOn}
              max={todayLocal()}
              onChange={(e) => setForm((f) => ({ ...f, bowledOn: e.target.value }))}
              required
            />
          </div>

          {BOWLERS.map(({ key, name }) => {
            const row = form.rows[key];
            const total = seriesSum(row.games);
            return (
              <fieldset key={key} className={`bw-sheet ${row.include ? "" : "is-off"}`}>
                <legend className="bw-sheet-name">
                  <label className="bw-check">
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={(e) => setRow(key, { include: e.target.checked })}
                    />
                    <span className={`bw-chip bw-chip--${key}`} aria-hidden="true" />
                    {name}
                  </label>
                </legend>
                <div className="bw-frames">
                  {row.games.map((g, i) => (
                    <div key={i} className="bw-frame">
                      <label htmlFor={`bw-${key}-${i}`}>Game {i + 1}</label>
                      <input
                        id={`bw-${key}-${i}`}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0"
                        value={g}
                        disabled={!row.include}
                        aria-invalid={row.include && g !== "" && !validGame(parseGame(g))}
                        onChange={(e) => setGame(key, i, e.target.value)}
                      />
                    </div>
                  ))}
                  <div className="bw-frame bw-frame--total" aria-live="polite">
                    <span>Series</span>
                    <output>{row.include && total !== null ? total : "-"}</output>
                  </div>
                </div>
              </fieldset>
            );
          })}

          {mismatched.length > 0 && (
            <p className="bw-warn">
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" /> Double-check{" "}
              {mismatched.map((r) => r.name).join(" and ")}: the games don't add up to the
              total on the screen.
            </p>
          )}

          {strangers.length > 0 && (
            <div className="bw-extras">
              <p>Also on the sheet. Tap one if it's actually you:</p>
              <ul>
                {strangers.map((r) => (
                  <li key={r.name}>
                    <span className="bw-extras-name">{r.name}</span>
                    <span className="bw-extras-games">{r.games.map((g) => g ?? "?").join(" / ")}</span>
                    {BOWLERS.map(({ key, name }) => (
                      <button
                        key={key}
                        type="button"
                        className="bw-link"
                        onClick={() => assignRow(key, r)}
                      >
                        Use as {name}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bw-field">
            <label htmlFor="bw-note">Note (optional)</label>
            <input
              id="bw-note"
              type="text"
              maxLength={200}
              placeholder="Lane 7, new ball, oily lanes..."
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>

          {error && (
            <p className="bw-error" role="alert">
              <i className="fa-solid fa-circle-exclamation" aria-hidden="true" /> {error}
            </p>
          )}

          <div className="bw-actions">
            <button type="submit" className="bw-btn bw-btn--primary" disabled={saving}>
              <i className={`fa-solid ${saving ? "fa-spinner fa-spin" : "fa-bowling-ball"}`} aria-hidden="true" />{" "}
              {saving ? "Saving" : editing ? "Save changes" : "Save night"}
            </button>
            {(editing || form.source === "photo") && (
              <button type="button" className="bw-btn bw-btn--ghost" onClick={reset}>
                {editing ? "Cancel" : "Start over"}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
};

export default EntryPanel;
