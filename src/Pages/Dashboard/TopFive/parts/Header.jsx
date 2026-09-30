import { Link } from "react-router-dom";
import { SoundToggle } from "./TableBars";
import { PACKS, SET, TOTAL_CARDS } from "../top5.data";

const LAYERS = [4, 3, 2, 1];

/** TOP DECK, extruded (3d-text-depth-layers): the depth grows in on arrival. */
const Wordmark = () => (
  <h1 className="td-mark" aria-label="Top Deck: my top 5 things">
    {LAYERS.map((i) => (
      <span key={i} className="td-mark-layer" style={{ "--i": i }} aria-hidden="true">
        TOP DECK
      </span>
    ))}
    <span className="td-mark-face" aria-hidden="true">
      TOP DECK
    </span>
  </h1>
);

export default function Header({ collected, sound, onToggleSound, onChecklist }) {
  return (
    <header className="td-head">
      <div className="td-head-bar td-reveal" style={{ "--n": 0 }}>
        <Link to="/dashboard" className="td-back" aria-label="Back to dashboard">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" />
          <span>OPS//CONSOLE</span>
        </Link>
        <div className="td-head-actions">
          <button type="button" className="td-tbtn" onClick={onChecklist}>
            <i className="fa-solid fa-list-check" aria-hidden="true" />
            <span>Checklist</span>
          </button>
          <SoundToggle on={sound} onToggle={onToggleSound} />
        </div>
      </div>
      <p className="td-kicker td-reveal" style={{ "--n": 1 }}>
        Set {SET.code} · {SET.series} · {TOTAL_CARDS} cards · {PACKS.length} packs
      </p>
      <Wordmark />
      <p className="td-sub td-reveal" style={{ "--n": 2 }}>
        My top 5 things, printed as a trading card set. Rip a pack, count down to number one,
        chase the legendary.
      </p>
      <div
        className="td-meter td-reveal"
        style={{ "--n": 3 }}
        role="img"
        aria-label={`Collected ${collected} of ${TOTAL_CARDS} cards`}
      >
        <div className="td-meter-top">
          <span>Collected</span>
          <b>
            {String(collected).padStart(2, "0")}/{TOTAL_CARDS}
          </b>
        </div>
        <span className="td-meter-track">
          <span className="td-meter-fill" style={{ "--p": collected / TOTAL_CARDS }} />
        </span>
      </div>
    </header>
  );
}
