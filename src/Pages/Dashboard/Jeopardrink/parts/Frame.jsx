import React, { useState } from "react";
import { Link } from "react-router-dom";
import { isMuted, setMuted } from "../sfx";

/* Shared chrome: back link, logo, room code, undo, mute. */

const MuteButton = () => {
  const [muted, setLocal] = useState(isMuted);
  const toggle = () => {
    setMuted(!muted);
    setLocal(!muted);
  };
  return (
    <button
      type="button"
      className="jd-iconbtn"
      onClick={toggle}
      aria-pressed={muted}
      aria-label={muted ? "Unmute sounds" : "Mute sounds"}
    >
      <i className={`fa-solid ${muted ? "fa-volume-xmark" : "fa-volume-high"}`} />
    </button>
  );
};

const Frame = ({ subtitle, roomCode, onRoomClick, canUndo, onUndo, wide, children }) => (
  <div className="jd">
    <div className="jd-spot" aria-hidden="true" />
    <div className={`jd-shell ${wide ? "is-wide" : ""}`}>
      <header className="jd-top">
        <Link to="/dashboard" className="jd-iconbtn" aria-label="Back to dashboard">
          <i className="fa-solid fa-chevron-left" />
        </Link>
        <div className="jd-brand">
          <span className="jd-logo">
            JEOPAR<em>DRINK!</em>
          </span>
          <span className="jd-sub">{subtitle}</span>
        </div>
        <div className="jd-top-actions">
          {roomCode && (
            <button
              type="button"
              className="jd-roompill"
              onClick={onRoomClick}
              aria-label={`Room ${roomCode}: show the join QR code`}
            >
              <i className="fa-solid fa-qrcode" aria-hidden="true" /> {roomCode}
            </button>
          )}
          {onUndo && (
            <button
              type="button"
              className="jd-iconbtn"
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo last move"
            >
              <i className="fa-solid fa-rotate-left" />
            </button>
          )}
          <MuteButton />
        </div>
      </header>
      {children}
    </div>
  </div>
);

export default Frame;
