import { useState } from "react";
import Reveal from "../../../Components/Reveal/Reveal";
import { saveEvent } from "../api";
import { daysBetween, fmtDate, fmtKm, fmtNum, fmtRelativeDays } from "../format";

/*
 * The maintenance schedule for one car, most urgent first. Each item counts
 * down from the last work-log entry that covered it, by km or by months,
 * whichever runs out first. The odometer comes from the highest reading in
 * the work log, so keeping it current is one quick entry here.
 */
const STATUS = {
  overdue: { label: "Overdue", icon: "fa-circle-exclamation" },
  soon: { label: "Due soon", icon: "fa-clock" },
  ok: { label: "OK", icon: "fa-check" },
  untracked: { label: "Needs km", icon: "fa-gauge" },
  unknown: { label: "No record", icon: "fa-question" },
};

const interval = ({ km, months }) =>
  [km && `every ${fmtKm(km)}`, months && `${km ? "or " : "every "}${months} months`].filter(Boolean).join(" ");

function dueText(s, today) {
  const bits = [];
  if (s.kmLeft !== null) bits.push(s.kmLeft < 0 ? `${fmtKm(-s.kmLeft)} overdue` : `${fmtKm(s.kmLeft)} to go`);
  if (s.daysLeft !== null) bits.push(s.daysLeft < 0 ? `due ${fmtRelativeDays(s.daysLeft)}` : `by ${fmtDate(s.dueDate)}`);
  if (s.eta && s.status !== "overdue") bits.push(`at your pace, ${fmtRelativeDays(daysBetween(today, s.eta))}`);
  return bits.join(" · ");
}

const ServicePlan = ({ getToken, car, statuses, odo, rate, loading, today, onLog, onChanged, onToast }) => {
  const [km, setKm] = useState("");
  const [on, setOn] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const saveReading = async (e) => {
    e.preventDefault();
    const digits = km.replace(/[,\s]/g, "");
    if (!/^\d+$/.test(digits)) {
      setError("Type the kilometres as a whole number, like 232450.");
      return;
    }
    setSaving(true);
    setError(null);
    const r = await saveEvent(getToken, {
      car: car.key,
      kind: "reading",
      happenedOn: on,
      odometerKm: Number(digits),
    });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setKm("");
    onToast("Odometer updated.");
    onChanged();
  };

  return (
    <div className="gr-service">
      <form className="gr-card gr-odo" onSubmit={saveReading}>
        <div>
          <p className="gr-odo-label">Odometer</p>
          <p className="gr-odo-value">{odo ? fmtKm(odo.km) : "Not logged yet"}</p>
          <p className="gr-odo-sub">
            {odo ? `Read ${fmtDate(odo.date)}` : "Add a reading so km-based items can count down."}
            {rate ? ` · about ${fmtNum(rate * 7)} km a week` : ""}
          </p>
        </div>
        <div className="gr-odo-form">
          <label className="gr-field">
            <span>New reading</span>
            <span className="gr-input-unit">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9 ,]*"
                required
                placeholder={odo ? String(odo.km) : "232450"}
                value={km}
                onChange={(e) => setKm(e.target.value)}
              />
              <em>km</em>
            </span>
          </label>
          <label className="gr-field">
            <span>On</span>
            <input type="date" required max={today} value={on} onChange={(e) => setOn(e.target.value)} />
          </label>
          <button type="submit" className="gr-btn gr-btn--primary" disabled={saving || !km}>
            {saving ? "Saving…" : "Update"}
          </button>
        </div>
        {error && (
          <p className="gr-banner" role="alert">
            {error}
          </p>
        )}
      </form>

      {loading ? (
        <div className="gr-row gr-row--ghost gr-row--tall" aria-busy="true" />
      ) : (
        <Reveal as="ul" className="gr-items">
          {statuses.map((s) => {
            const meta = STATUS[s.status];
            const pct = s.fraction === null ? 0 : Math.min(s.fraction, 1);
            return (
              <li key={s.item.key} className={`gr-item is-${s.status}`}>
                <div className="gr-item-top">
                  <div>
                    <p className="gr-item-name">{s.item.label}</p>
                    <p className="gr-item-interval">{interval(s.item)}</p>
                  </div>
                  <span className={`gr-badge gr-badge--${s.status}`}>
                    <i className={`fa-solid ${meta.icon}`} aria-hidden="true" /> {meta.label}
                  </span>
                </div>
                {s.fraction !== null && (
                  <div
                    className="gr-meter"
                    role="meter"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(s.fraction * 100)}
                    aria-label={`${s.item.label}: ${Math.round(s.fraction * 100)}% of the interval used`}
                  >
                    <span style={{ "--p": pct }} />
                  </div>
                )}
                <p className="gr-item-due">
                  {s.status === "unknown"
                    ? "No entry covers this yet."
                    : s.status === "untracked"
                      ? `Last done ${fmtDate(s.last.happenedOn)}, without the km. Edit that entry to add it.`
                      : dueText(s, today)}
                </p>
                {s.last && (
                  <p className="gr-item-last">
                    Last: {fmtDate(s.last.happenedOn)}
                    {s.last.odometerKm !== null ? ` at ${fmtKm(s.last.odometerKm)}` : ""}
                  </p>
                )}
                <button type="button" className="gr-link" onClick={() => onLog(s.item)}>
                  <i className="fa-solid fa-plus" aria-hidden="true" /> Log it
                </button>
              </li>
            );
          })}
        </Reveal>
      )}

      <p className="gr-caveat">
        Intervals are starting points from the {car.make} schedule, tightened where tuned and high-mileage cars are
        usually serviced sooner. Check them against your manual.
      </p>
    </div>
  );
};

export default ServicePlan;
