import { FRAMES, frameMarks, playFrame, scoreGame } from "../scoring";
import "./frames.css";

/*
 * One game as a ten-frame score sheet: marks on top, running total below.
 * A strike in frames 1-9 sits in the right-hand box like on a real sheet,
 * and a split's first ball gets circled. With `onPick`, finished frames
 * are buttons (the lane screen uses that to re-enter one).
 */
function boxes(frame, i) {
  const marks = frame ? frameMarks(frame, i) : [];
  if (i < FRAMES - 1 && marks.length === 1 && marks[0].mark === "X") return [null, marks[0]];
  return Array.from({ length: i === FRAMES - 1 ? 3 : 2 }, (_, k) => marks[k] || null);
}

const Scorecard = ({ frames, current = null, onPick, label, className = "" }) => {
  const { running } = scoreGame(frames);
  return (
    <ol className={`bw-sheet10 ${className}`} aria-label={label}>
      {Array.from({ length: FRAMES }, (_, i) => {
        const frame = frames[i];
        const cells = boxes(frame, i);
        const done = Boolean(frame) && playFrame(frame, i).next === null;
        const pickable = Boolean(onPick) && done && i !== current;
        const said = cells.filter(Boolean).map((c) => c.mark).join(" ");
        const Tag = pickable ? "button" : "div";
        return (
          <li key={i} className={`bw-sheet10-frame ${i === current ? "is-now" : ""}`}>
            <Tag
              {...(pickable ? { type: "button", onClick: () => onPick(i) } : {})}
              className="bw-sheet10-cell"
            >
              <span className="bw-sheet10-no" aria-hidden="true">
                {i + 1}
              </span>
              <span className="bw-sheet10-marks" aria-hidden="true">
                {cells.map((c, k) => (
                  <span key={k} className={`bw-sheet10-box ${c && c.split ? "is-split" : ""}`}>
                    {c ? c.mark : ""}
                  </span>
                ))}
              </span>
              <span className="bw-sheet10-total" aria-hidden="true">
                {running[i] ?? ""}
              </span>
              <span className="sr-only">
                {pickable ? "Re-enter " : ""}frame {i + 1}: {said || "not bowled"}
                {running[i] !== null && running[i] !== undefined ? `, ${running[i]}` : ""}
              </span>
            </Tag>
          </li>
        );
      })}
    </ol>
  );
};

export default Scorecard;
