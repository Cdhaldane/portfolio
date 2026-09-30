import { memo } from "react";
import { SET } from "../top5.data";
import { prand } from "../poses";

/** Fraction of the wrapper height that tears away as the strip. */
export const STRIP = 0.14;

// A torn edge, identical on every visit (index-seeded, no Math.random).
const TEETH = 16;
export const TORN_CLIP = `polygon(${[
  ...Array.from({ length: TEETH + 1 }, (_, k) => {
    const y = (STRIP * 100 + (k % 2 ? 2.2 : -0.6) + prand(k + 40) * 1.4).toFixed(2);
    return `${((k / TEETH) * 100).toFixed(2)}% ${y}%`;
  }),
  "100% 100%",
  "0% 100%",
].join(", ")})`;

/*
 * The booster wrapper art. It fills its parent, which sets --pw (the pack
 * width) and --h (the pack's hue). Decorative only: the accessible name
 * lives on the button that hosts it.
 */
const PackArt = memo(function PackArt({ pack, secret = false }) {
  return (
    <span className={`td-art ${secret ? "is-secret" : ""}`} aria-hidden="true">
      <span className="td-art-crimp td-art-crimp--top" />
      <span className="td-art-perf" />
      <span className="td-art-set">
        {SET.code} · {secret ? "???" : SET.series.toUpperCase()}
      </span>
      <span className="td-art-emblem">
        <i className={`fa-solid ${pack.icon}`} />
      </span>
      <span className="td-art-name">{pack.name}</span>
      <span className="td-art-tag">{pack.tagline}</span>
      <span className="td-art-fine">5 CARDS · NO FILLER</span>
      <span className="td-art-crimp td-art-crimp--bottom" />
      <span className="td-art-sheen" />
    </span>
  );
});

export default PackArt;
