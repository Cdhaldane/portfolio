import { useEffect, useRef, useState } from "react";
import { AREAS, MODS, MOD_BY_ID } from "../car/mods.mjs";

/*
 * The build, in 3D: the Golf R as it sits today, built in code (car/model.mjs)
 * and lit in a studio (car/scene.mjs), beside the list of every mod on it.
 * Pick a mod in the list or on the car and the camera flies to it: the hood
 * lifts for the engine bay, the body goes x-ray for the exhaust, the glass
 * clears for the cabin. The list renders at once; three.js loads behind it.
 */
const pad = (n) => String(n).padStart(2, "0");
const NUMBER = Object.fromEntries(MODS.map((m, i) => [m.id, pad(i + 1)]));

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const Build = ({ car }) => {
  const canvasRef = useRef(null);
  const roomRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [spin, setSpin] = useState(() => !reducedMotion());

  useEffect(() => {
    let alive = true;
    let room = null;
    import("../car/scene.mjs")
      .then(({ createShowroom }) => {
        if (!alive || !canvasRef.current) return;
        room = createShowroom(canvasRef.current, {
          reducedMotion: reducedMotion(),
          onPick: (id) => setSelected(id),
          onHover: (id) => setHovered(id),
        });
        roomRef.current = room;
        setStatus("ready");
      })
      .catch(() => alive && setStatus("failed"));
    return () => {
      alive = false;
      roomRef.current = null;
      room?.dispose();
    };
  }, []);

  useEffect(() => {
    roomRef.current?.select(selected);
  }, [selected, status]);
  useEffect(() => {
    roomRef.current?.hover(hovered);
  }, [hovered, status]);
  useEffect(() => {
    roomRef.current?.setSpin(spin);
  }, [spin, status]);

  const mod = selected ? MOD_BY_ID[selected] : null;
  const toggle = (id) => setSelected((cur) => (cur === id ? null : id));
  const onStageKey = (e) => {
    if (e.key === "Escape" && selected) setSelected(null);
  };

  return (
    <div className="gr-model">
      <div className={`gr-model-stage is-${status}`} onKeyDown={onStageKey}>
        <div className="gr-model-view">
          <canvas
            ref={canvasRef}
            className="gr-model-canvas"
            role="img"
            aria-label={`3D model of the ${car.year} ${car.name} with ${MODS.length} mods${mod ? `, showing the ${mod.name.toLowerCase()}` : ""}`}
          />

          <div className="gr-model-chrome">
            <p className="gr-model-kicker">
              Build <span>·</span> {MODS.length} mods
            </p>
            <div className="gr-model-tools">
              <button
                type="button"
                className={`gr-model-tool ${spin ? "is-on" : ""}`}
                aria-pressed={spin}
                onClick={() => setSpin((s) => !s)}
                disabled={status !== "ready" || reducedMotion()}
                title="Turntable"
              >
                <i className="fa-solid fa-rotate" aria-hidden="true" />
                <span className="sr-only">Turntable</span>
              </button>
              <button
                type="button"
                className="gr-model-tool"
                onClick={() => {
                  setSelected(null);
                  roomRef.current?.reset();
                }}
                disabled={status !== "ready"}
                title="Reset view"
              >
                <i className="fa-solid fa-expand" aria-hidden="true" />
                <span className="sr-only">Reset view</span>
              </button>
            </div>
          </div>

          {status === "loading" && <p className="gr-model-status">Warming up the shop lights…</p>}
          {status === "failed" && (
            <p className="gr-model-status">
              <i className="fa-solid fa-cube" aria-hidden="true" />
              The 3D view needs WebGL, which this browser has switched off. The build list still works.
            </p>
          )}
        </div>

        <div className="gr-model-caption" aria-live="polite">
          {mod ? (
            <div key={mod.id} className="gr-model-card">
              <p className="gr-model-card-n">
                {NUMBER[mod.id]} / {pad(MODS.length)} · {AREAS.find((a) => a.key === mod.area).label}
              </p>
              <h3>{mod.name}</h3>
              <p className="gr-model-card-brand">{mod.brand}</p>
              <p className="gr-model-card-note">{mod.note}</p>
              {mod.id === "tune" && car.tune && (
                <p className="gr-model-card-maps">
                  {car.tune.ecu}
                  <br />
                  {car.tune.tcm}
                </p>
              )}
              <button type="button" className="gr-link" onClick={() => setSelected(null)}>
                Back to the whole car
              </button>
            </div>
          ) : (
            status === "ready" && (
              <p className="gr-model-hint">
                <i className="fa-solid fa-hand-pointer" aria-hidden="true" /> Drag to turn it. Pick a mod to see it.
              </p>
            )
          )}
        </div>
      </div>

      <div className="gr-model-list">
        {AREAS.map((area) => {
          const mods = MODS.filter((m) => m.area === area.key);
          return (
            <section key={area.key} className="gr-model-group" aria-labelledby={`gr-area-${area.key}`}>
              <h3 id={`gr-area-${area.key}`} className="gr-model-area">
                {area.label}
                <span>{pad(mods.length)}</span>
              </h3>
              <ol>
                {mods.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`gr-model-item ${selected === m.id ? "is-on" : ""} ${hovered === m.id ? "is-hot" : ""}`}
                      aria-pressed={selected === m.id}
                      onClick={() => toggle(m.id)}
                      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(m.id)}
                      onPointerLeave={() => setHovered((h) => (h === m.id ? null : h))}
                      onFocus={() => setHovered(m.id)}
                      onBlur={() => setHovered((h) => (h === m.id ? null : h))}
                    >
                      <span className="gr-model-n">{NUMBER[m.id]}</span>
                      <span className="gr-model-name">
                        {m.name}
                        <small>{m.brand}</small>
                      </span>
                      <i className="fa-solid fa-arrow-right gr-model-go" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
        <p className="gr-hint">
          Modelled in code to the car&rsquo;s real dimensions, not scanned. Every mod is its own part, so it lights up
          on its own.
        </p>
      </div>
    </div>
  );
};

export default Build;
