import React, { useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";

/*
 * Scan-to-join: a QR code for the room's /buzz/CODE link (the buzzer page
 * prefills the code from it), plus a pop-up sheet so late arrivals can join
 * mid-game without the host digging back to setup. Dark modules on white
 * with a quiet zone, because that's what phone cameras read best.
 */

export const inviteLink = (code) => `${window.location.origin}/buzz/${code}`;
const joinHost = () => window.location.host;

export const JoinQr = ({ code }) => (
  <div className="jd-qr">
    <QRCodeSVG
      value={inviteLink(code)}
      size={240}
      level="M"
      marginSize={2}
      bgColor="#ffffff"
      fgColor="#01021c"
      role="img"
      aria-label={`QR code: scan to join room ${code}`}
    />
  </div>
);

export const CodeLetters = ({ code }) => (
  <span className="jd-roomcode-letters" aria-label={`Room code ${code.split("").join(" ")}`}>
    {code.split("").map((ch, i) => (
      <span key={i} style={{ "--i": i }}>
        {ch}
      </span>
    ))}
  </span>
);

export const JoinSheet = ({ code, onClose }) => {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="jd-sheet" onClick={onClose}>
      <div
        className="jd-sheet-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jd-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="jd-iconbtn jd-sheet-close" onClick={onClose} aria-label="Close">
          <i className="fa-solid fa-xmark" />
        </button>
        <h2 id="jd-sheet-title" className="jd-sheet-title">
          Grab a buzzer
        </h2>
        <JoinQr code={code} />
        <p className="jd-roomcode-label">
          or go to <strong>{joinHost()}/buzz</strong> and enter
        </p>
        <CodeLetters code={code} />
        <p className="jd-fine">Late arrivals start at $0. Harsh, but fair.</p>
      </div>
    </div>
  );
};
