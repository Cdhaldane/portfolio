import { PHASE } from "../deckReducer";

export const SoundToggle = ({ on, onToggle, className = "" }) => (
  <button
    type="button"
    className={`td-tbtn td-tbtn--icon ${className}`}
    aria-pressed={on}
    aria-label="Sound effects"
    onClick={onToggle}
  >
    <i className={`fa-solid ${on ? "fa-volume-high" : "fa-volume-xmark"}`} aria-hidden="true" />
  </button>
);

export function TopBar({
  pack,
  collected,
  prevName,
  nextName,
  canSwitch,
  canReseal,
  sound,
  onLeave,
  onSwitch,
  onReseal,
  onToggleSound,
}) {
  return (
    <header className="td-table-top">
      <button type="button" className="td-tbtn" onClick={onLeave}>
        <i className="fa-solid fa-arrow-left" aria-hidden="true" />
        <span>All packs</span>
      </button>
      <div className="td-table-title" style={{ "--h": pack.hue }}>
        <span className="td-table-emblem" aria-hidden="true">
          <i className={`fa-solid ${pack.icon}`} />
        </span>
        <b>{pack.name}</b>
        <span className="td-mono">{collected}/5</span>
      </div>
      <div className="td-table-actions">
        {canReseal ? (
          <button type="button" className="td-tbtn td-tbtn--ghost" onClick={onReseal}>
            <i className="fa-solid fa-rotate-right" aria-hidden="true" />
            <span>Rip again</span>
          </button>
        ) : null}
        <button
          type="button"
          className="td-tbtn td-tbtn--nav"
          aria-label={`Previous pack: ${prevName}`}
          onClick={() => onSwitch(-1)}
          disabled={!canSwitch}
        >
          <i className="fa-solid fa-chevron-left" aria-hidden="true" />
          <span className="td-tbtn-name">{prevName}</span>
        </button>
        <button
          type="button"
          className="td-tbtn td-tbtn--nav"
          aria-label={`Next pack: ${nextName}`}
          onClick={() => onSwitch(1)}
          disabled={!canSwitch}
        >
          <span className="td-tbtn-name">{nextName}</span>
          <i className="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
        <SoundToggle on={sound} onToggle={onToggleSound} />
      </div>
    </header>
  );
}

const Caption = ({ info, hint }) =>
  info ? (
    <div className="td-caption" aria-hidden="true">
      <p className="td-caption-head">
        <span className="td-mono">
          #{info.rank} · {info.label}
        </span>
        <b>{info.title}</b>
      </p>
      <p className="td-caption-take">{info.take}</p>
    </div>
  ) : (
    <p className="td-hint">{hint}</p>
  );

const isActivate = (e) => e.key === "Enter" || e.key === " ";

export function BottomBar({
  phase,
  reduced,
  fine,
  info,
  backShown,
  primaryRef,
  flipRef,
  onRip,
  onSkip,
  onHold,
  onRelease,
  onRevealClick,
  onStep,
  onFlip,
  onClose,
}) {
  let body = null;
  if (phase === PHASE.SEALED) {
    body = (
      <>
        <p className="td-hint">
          {reduced ? "Ready when you are." : "Drag across the top to tear. (It's cathartic.)"}
        </p>
        <button ref={primaryRef} type="button" className="td-cta" onClick={onRip}>
          <i className="fa-solid fa-scissors" aria-hidden="true" />
          {reduced ? "Open pack" : "Rip it open"}
        </button>
      </>
    );
  } else if (phase === PHASE.LEGEND) {
    body = (
      <>
        <p className="td-hint">{fine ? "Hold for maximum hype." : "Press and hold for maximum hype."}</p>
        <button
          ref={primaryRef}
          type="button"
          className="td-cta td-cta--gold"
          onPointerDown={onHold}
          onPointerUp={onRelease}
          onPointerLeave={onRelease}
          onPointerCancel={onRelease}
          onKeyDown={(e) => {
            if (!isActivate(e)) return;
            e.preventDefault();
            if (!e.repeat) onHold();
          }}
          onKeyUp={(e) => {
            if (!isActivate(e)) return;
            e.preventDefault();
            onRelease();
          }}
          onClick={onRevealClick}
        >
          <i className="fa-solid fa-crown" aria-hidden="true" />
          Reveal your legendary card
        </button>
      </>
    );
  } else if (phase === PHASE.INSPECT) {
    body = (
      <div className="td-toolbar" role="toolbar" aria-label="Card controls">
        <button type="button" className="td-tbtn" onClick={() => onStep(-1)}>
          <i className="fa-solid fa-chevron-left" aria-hidden="true" />
          <span>Prev</span>
        </button>
        <button ref={flipRef} type="button" className="td-cta" aria-pressed={backShown} onClick={onFlip}>
          <i className="fa-solid fa-rotate" aria-hidden="true" />
          Flip
        </button>
        <button type="button" className="td-tbtn" onClick={() => onStep(1)}>
          <span>Next</span>
          <i className="fa-solid fa-chevron-right" aria-hidden="true" />
        </button>
        <button type="button" className="td-tbtn td-tbtn--icon" aria-label="Close card" onClick={onClose}>
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>
    );
  } else if (phase === PHASE.HAND) {
    body = (
      <>
        <Caption
          info={info}
          hint={
            fine
              ? "Hover the fan · Enter to inspect · 1–5 jump · [ ] packs · Esc back"
              : "Tap a card to lift it, tap again to look closer."
          }
        />
      </>
    );
  } else {
    body = (
      <>
        <Caption info={info} hint="Dealing…" />
        <button type="button" className="td-tbtn td-tbtn--ghost" onClick={onSkip}>
          <span>Skip</span>
          <i className="fa-solid fa-forward" aria-hidden="true" />
        </button>
      </>
    );
  }
  return <footer className={`td-table-bottom td-table-bottom--${phase}`}>{body}</footer>;
}
