import { THRESHOLDS } from "../cars";
import { fmtDate, fmtDuration, fmtKm, fmtNum, fmtRelativeDays, daysBetween } from "../format";
import { nextDue } from "../service";
import Dial from "./Dial";

/*
 * The selected car, front and centre: its name set big, the spec line in
 * mono, and an instrument cluster. Left dial: how far into its interval the
 * most urgent service item is. Right dial: peak charge air temp of the
 * latest log, zoned at the heat-soak thresholds. Between them, a cluster
 * screen with the odometer and the last log. Keyed by car upstream, so a
 * switch remounts it and the needles sweep again, like turning the key.
 */
const CAT_SCALE = 120;

function serviceReadout(due, today) {
  if (!due) return { readout: "–", sub: "Log a service to start tracking" };
  const { item, kmLeft, daysLeft, eta, status } = due;
  const parts = [];
  if (kmLeft !== null) parts.push(kmLeft < 0 ? `${fmtKm(-kmLeft)} over` : `${fmtKm(kmLeft)} left`);
  if (daysLeft !== null && (kmLeft === null || daysLeft < 60)) {
    parts.push(`due ${fmtRelativeDays(daysLeft)}`);
  } else if (eta && status !== "overdue") {
    parts.push(`about ${fmtRelativeDays(daysBetween(today, eta))}`);
  }
  return { readout: `${Math.round(due.fraction * 100)}`, sub: `${item.label} · ${parts.join(", ")}` };
}

const CarHero = ({ car, logs, statuses, odo, loading, today }) => {
  const latest = logs[0] || null;
  const latestRunning = logs.find((l) => l.catMaxC !== null) || null;
  const mapped = logs.find((l) => l.ecuMap) || null;
  const due = nextDue(statuses);
  const service = serviceReadout(due, today);

  const tune = mapped
    ? [mapped.ecuMap, mapped.tcmMap].filter(Boolean).map((m) => m.replace(/\.ptm$/i, ""))
    : car.tune
      ? [car.tune.ecu, car.tune.tcm]
      : [];

  return (
    <section className="gr-hero" aria-labelledby="gr-car-name">
      <div className="gr-hero-copy">
        <p className="gr-kicker">
          {car.year} · {car.make} · {car.chassis}
        </p>
        <h1 id="gr-car-name" className="gr-car-name" style={{ "--len": car.name.length }}>
          {car.name.split("").map((ch, i) => (
            <span key={i} className="gr-car-letter" style={{ "--i": i }}>
              {ch === " " ? " " : ch}
            </span>
          ))}
        </h1>
        <ul className="gr-specs">
          {car.specs.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        {tune.length > 0 && (
          <p className="gr-tune">
            <i className="fa-solid fa-microchip" aria-hidden="true" />
            <span>
              {tune.join(" · ")}
              <small>{mapped ? "from the latest log" : "from the car's file"}</small>
            </span>
          </p>
        )}
        <p className="gr-loggers">Logged with {car.loggers}</p>
      </div>

      <div className={`gr-cluster ${loading ? "is-loading" : ""}`}>
        <Dial
          fraction={loading || !due ? null : due.fraction}
          zones={[
            { from: 0.8, to: 0.95, level: "watch" },
            { from: 0.95, to: 1, level: "warn" },
          ]}
          scale={["0", "100"]}
          readout={loading ? "–" : service.readout}
          unit={due ? "%" : ""}
          label="Next service"
          sub={loading ? "Reading…" : service.sub}
        />

        <div className="gr-screen" role="group" aria-label="Odometer and last log">
          <p className="gr-screen-odo">
            <span className="gr-screen-digits">{odo ? fmtNum(odo.km) : "------"}</span>
            <span className="gr-screen-unit">km</span>
          </p>
          <p className="gr-screen-line">
            {odo ? `Read ${fmtDate(odo.date, { month: "short", day: "numeric" })}` : "No odometer yet"}
          </p>
          <p className="gr-screen-line">
            {latest
              ? `Last log ${fmtDate(latest.recordedOn, { month: "short", day: "numeric" })} · ${fmtDuration(latest.durationS)}`
              : "No logs yet"}
          </p>
          <p className="gr-screen-line gr-screen-line--dim">
            {logs.length} log{logs.length === 1 ? "" : "s"} ·{" "}
            {fmtDuration(logs.reduce((a, l) => a + (l.durationS || 0), 0))}
          </p>
        </div>

        <Dial
          fraction={loading || !latestRunning ? null : latestRunning.catMaxC / CAT_SCALE}
          zones={[
            { from: THRESHOLDS.catMaxC.watch / CAT_SCALE, to: THRESHOLDS.catMaxC.warn / CAT_SCALE, level: "watch" },
            { from: THRESHOLDS.catMaxC.warn / CAT_SCALE, to: 1, level: "warn" },
          ]}
          scale={["0", String(CAT_SCALE)]}
          readout={latestRunning ? fmtNum(latestRunning.catMaxC) : "–"}
          unit={latestRunning ? "°C" : ""}
          label="Peak charge air"
          sub={
            latestRunning
              ? `Log of ${fmtDate(latestRunning.recordedOn, { month: "short", day: "numeric" })}`
              : "Upload a log to fill this in"
          }
        />
      </div>
    </section>
  );
};

export default CarHero;
