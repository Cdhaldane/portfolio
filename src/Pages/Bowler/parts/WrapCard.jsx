import { useEffect, useRef, useState } from "react";
import { formatNight } from "../bowlers";
import { wrapFacts } from "../insights";
import { drawWrapCard } from "../wrapCanvas";

/*
 * The night's wrap card in a native <dialog> (focus trap + Esc for free).
 * Share uses the phone's share sheet when it can take files, otherwise the
 * PNG downloads. The plain-text lines can be copied too.
 */
const WrapCard = ({ date, series, onClose }) => {
  const dialogRef = useRef(null);
  const [blob, setBlob] = useState(null);
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const facts = date ? wrapFacts(series, date) : null;
  const factsKey = facts ? facts.lines.join("|") : "";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (date && !dialog.open) dialog.showModal();
    if (!date && dialog.open) dialog.close();
    return undefined;
  }, [date]);

  useEffect(() => {
    if (!date || !facts || !facts.bowlers.length) return undefined;
    let cancelled = false;
    let objectUrl = null;
    setBlob(null);
    setError(null);
    drawWrapCard(facts)
      .then((b) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // factsKey captures every input the drawing depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, factsKey]);

  const filename = date ? `bowler-${date}.png` : "bowler.png";

  async function share() {
    if (!blob) return;
    const file = new File([blob], filename, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: facts.lines.join("\n") });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // user closed the sheet
      }
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(facts.lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Couldn't copy. Long-press the card to save it instead.");
    }
  }

  return (
    <dialog ref={dialogRef} className="bw-wrap" onClose={onClose} aria-labelledby="bw-wrap-title">
      {date && (
        <div className="bw-wrap-inner">
          <header className="bw-wrap-head">
            <h2 id="bw-wrap-title" className="bw-h2">
              {formatNight(date, { month: "long", day: "numeric" })} wrap card
            </h2>
            <button type="button" className="bw-wrap-x" onClick={() => dialogRef.current.close()}>
              <i className="fa-solid fa-xmark" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </button>
          </header>
          <div className="bw-wrap-preview">
            {url && blob ? (
              <img src={url} alt={facts.lines.join(". ")} />
            ) : error ? (
              <p className="bw-error" role="alert">{error}</p>
            ) : (
              <span className="bw-skel bw-wrap-skel" aria-label="Drawing the card" />
            )}
          </div>
          <div className="bw-actions">
            <button type="button" className="bw-btn bw-btn--primary" disabled={!blob} onClick={share}>
              <i className="fa-solid fa-share-nodes" aria-hidden="true" /> Share
            </button>
            <button type="button" className="bw-btn bw-btn--ghost" onClick={copyText}>
              <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`} aria-hidden="true" />{" "}
              {copied ? "Copied" : "Copy text"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
};

export default WrapCard;
