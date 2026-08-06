import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";

import "./GallowsHymnLauncher.css";

/*
 * Launcher for the hidden game at /gallows-hymn.
 *
 * Per GALLOWS_HYMN.md §18.2 this is deliberately a LAUNCHER, not a gate: no
 * password, no auth. The route is hidden by being unlinked and noindexed so the
 * link can be handed to anyone with zero friction, and the leaderboard is
 * explicitly global. There is nothing private here to protect.
 *
 * Two jobs beyond looking good:
 *   1. Check WebGL2 *before* the visitor commits to a download.
 *   2. Turn mobile away kindly rather than serving a broken 12fps experience.
 *
 * The game itself is a separate Vite app (portfolio/game) served from /hymn/.
 * In development it runs on its own dev server so it keeps HMR.
 */

const GAME_URL =
  process.env.NODE_ENV === "development" ? "http://localhost:3040/" : "/hymn/";

/** Coarse pointer + no hover ⇒ touch device. A trap shooter needs a mouse. */
function detectTouchOnly() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return (
    window.matchMedia("(pointer: coarse)").matches &&
    !window.matchMedia("(hover: hover)").matches
  );
}

function detectWebgl2() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}

const GallowsHymnLauncher = () => {
  const [support, setSupport] = useState(null);
  const touchOnly = useMemo(detectTouchOnly, []);

  useEffect(() => {
    setSupport({ webgl2: detectWebgl2() });
  }, []);

  // The page owns the whole viewport; keep the document from scrolling behind it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const blocked = touchOnly || (support && !support.webgl2);

  return (
    <div className="gh-launch">
      <Helmet>
        {/* Hidden route: unlinked, unindexed. Never in the sitemap. */}
        <meta name="robots" content="noindex,nofollow" />
        <title>Gallows Hymn</title>
      </Helmet>

      <div className="gh-launch-sky" aria-hidden="true" />
      <div className="gh-launch-hill" aria-hidden="true" />
      <div className="gh-launch-fog" aria-hidden="true" />

      {/* Boot Hill's fence: the graveyard keeps the name the game grew out of. */}
      <div className="gh-launch-stones" aria-hidden="true">
        {[12, 26, 38, 52, 68, 79, 91].map((left, i) => (
          <span key={left} style={{ "--l": `${left}%`, "--i": i }} />
        ))}
      </div>

      <div className="gh-launch-lantern" aria-hidden="true">
        <i className="gh-launch-lantern-arm" />
        <i className="gh-launch-lantern-body" />
        <i className="gh-launch-lantern-glow" />
      </div>

      <main className="gh-launch-main">
        <div className="gh-launch-sign">
          <span className="gh-launch-sign-line">BONE ORCHARD</span>
          <span className="gh-launch-sign-sub">NO TRESPASSING</span>
        </div>

        <h1 className="gh-launch-title" aria-label="Gallows Hymn">
          {"GALLOWS".split("").map((c, i) => (
            <span key={`g${i}`} style={{ "--d": `${i * 45}ms` }}>
              {c}
            </span>
          ))}
          <em />
          {"HYMN".split("").map((c, i) => (
            <span key={`h${i}`} style={{ "--d": `${(i + 8) * 45}ms` }}>
              {c}
            </span>
          ))}
        </h1>

        <p className="gh-launch-pitch">
          A trap-defense third-person shooter. The dead don't stay buried, iron and
          salt are the only things that work, and the traps do the killing — but you
          have to be in the room for it to be good.
        </p>

        <div className="gh-launch-meta">
          <span>M0 · VERTICAL PROOF</span>
          <span>WESTERN GOTHIC</span>
          <span>DESKTOP · MOUSE + KEYBOARD</span>
        </div>

        {blocked ? (
          <div className="gh-launch-block">
            {touchOnly ? (
              <>
                <strong>This one needs a mouse.</strong>
                <span>
                  Gallows Hymn is a third-person shooter with a build cursor — touch
                  controls are their own project. Come back on a desktop.
                </span>
              </>
            ) : (
              <>
                <strong>Your browser can't run WebGL2.</strong>
                <span>
                  Try a current Chrome, Edge, Firefox or Safari with hardware
                  acceleration enabled.
                </span>
              </>
            )}
          </div>
        ) : (
          <a className="gh-launch-play" href={GAME_URL}>
            <span>RING THE BELL</span>
            <i className="fa-solid fa-angles-right" />
          </a>
        )}

        <dl className="gh-launch-facts">
          <div>
            <dt>Engine</dt>
            <dd>three.js · fixed 60Hz deterministic sim</dd>
          </div>
          <div>
            <dt>World</dt>
            <dd>Generated from code, not modelled</dd>
          </div>
          <div>
            <dt>Replays</dt>
            <dd>Seed + command log, hash-verified</dd>
          </div>
        </dl>
      </main>

      <Link className="gh-launch-back" to="/">
        <i className="fa-solid fa-chevron-left" /> RETURN TO SITE
      </Link>
    </div>
  );
};

export default GallowsHymnLauncher;
