import { LEVELS } from "../cars";

/** A finding level as a badge: colour, icon and word, never colour alone. */
const Level = ({ level, label }) => {
  const meta = LEVELS[level];
  if (!meta) return null;
  return (
    <span className={`gr-level gr-level--${level}`}>
      <i className={`fa-solid ${meta.icon}`} aria-hidden="true" />
      {label || meta.label}
    </span>
  );
};

export default Level;
