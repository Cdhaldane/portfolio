/*
 * ui/Menu.tsx — the muster screen. Pick your ground, pick your Vigil, ring in.
 *
 * HEROES.md §8 listed this as the thing that replaces `?hero=ada`, and MAPS gave
 * it a second axis the moment there was more than one site. It is also the first
 * thirty seconds of the game, which §1's five-second test says carries the whole
 * portfolio claim — so it is a designed screen rather than a settings dialog.
 *
 * Three decisions worth stating:
 *
 *  1. **The map preview is the real map.** Choosing a site rebuilds the world
 *     behind the card, so the ground you are reading about is the ground drawn
 *     three metres away. A screenshot of a level would have been cheaper and
 *     would have started lying the first time someone edited a map; this cannot
 *     drift, because it *is* the map. It costs a world rebuild per click, which
 *     is the same work the game already does when a run travels between sites.
 *
 *  2. **`ROTATION` is the default and is listed first.** §4's site rotation is
 *     the designed run — the geometry puzzle refreshing every few rounds is
 *     content, not chrome — so the menu must not quietly talk players out of it.
 *     Picking a named map locks the run to it, which is a practice mode, and the
 *     card says so.
 *
 *  3. **Nothing here is a stat choice.** Per HEROES.md §6 the two Vigils are
 *     mechanically identical, so the hero cards sell *character* and say plainly
 *     that the choice is cosmetic. A menu that implies a balance decision where
 *     there isn't one teaches players to distrust the next menu that doesn't.
 *
 * This component owns its copy. Names and sizes are read from `SITES` and
 * `HEROES` so they cannot drift from the data, but the prose lives here — a
 * blurb is presentation, and `sim/sites.ts` should not be carrying marketing.
 */

import { HEROES, HERO, type HeroId } from "../render/models/hero.ts";
import { SITES, SITE } from "../sim/sites.ts";
import { CSS } from "../render/palette.ts";

/** `undefined` means §4 rotation rather than a specific map. */
export type SitePick = number | undefined;

export interface Muster {
  hero: HeroId;
  site: SitePick;
}

/**
 * Per-hero flavour. Kept next to the cards rather than in `models/hero.ts`,
 * which owns geometry and has no business holding ad copy.
 */
const HERO_COPY: Record<HeroId, { line: string; blurb: string; accent: string }> = {
  [HERO.amos]: {
    line: "Nobody swore me out of it.",
    blurb:
      "The last marshal of Hollow Creek, still wearing the oath the Bell cannot " +
      "tune. Wide brim, storm yoke, and a coat that moves.",
    accent: CSS.lamp,
  },
  [HERO.ada]: {
    line: "I know every one of them by name.",
    blurb:
      "The undertaker. She filled these graves once already and signed for every " +
      "one of them. Veiled, narrow, and entirely unimpressed.",
    accent: CSS.sunbleach,
  },
};

/**
 * Per-site flavour, keyed by `SiteDef.key` so a new map shows up as soon as it
 * is added — with a placeholder blurb rather than a crash or a blank card.
 */
const SITE_COPY: Record<string, string> = {
  boothill:
    "Open sightlines and long lanes. The control every other map is measured " +
    "against — nothing here invalidates anything, which makes it the one place " +
    "you can learn what a trap actually does.",
  creekpinch:
    "One corridor and one pinch. Retired from the rotation for being a solved " +
    "problem, kept because a solved problem is a good place to practise.",
  undertown:
    "The town that fell thirty metres. No sky, no moon — everything you can see " +
    "is a lamp somebody placed, and there is a wall you can pay to open.",
};

function Card({
  selected,
  onSelect,
  accent,
  kicker,
  title,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  accent: string;
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="gh-pick"
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={onSelect}
      style={{ ["--pick-accent" as string]: accent }}
    >
      <span className="gh-pick-kicker">{kicker}</span>
      <span className="gh-pick-title">{title}</span>
      <span className="gh-pick-body">{children}</span>
    </button>
  );
}

export default function Menu({
  muster,
  onChange,
  onStart,
  booting,
  best,
}: {
  muster: Muster;
  onChange: (next: Muster) => void;
  onStart: () => void;
  booting: boolean;
  best: { round: number; tally: number } | null;
}) {
  return (
    <div className="gh-menu">
      <header className="gh-menu-head">
        <span className="gh-kicker" style={{ color: CSS.ember }}>
          M0 · VERTICAL PROOF
        </span>
        <h1 className="gh-title">GALLOWS HYMN</h1>
        <p className="gh-sub">Wire the ground. Ring the bell. Stand in it.</p>
      </header>

      <section className="gh-menu-section">
        <h2 className="gh-menu-h">
          THE GROUND
          <span className="gh-menu-note">
            the map behind this card is the one you picked
          </span>
        </h2>
        <div className="gh-picks">
          <Card
            selected={muster.site === undefined}
            onSelect={() => onChange({ ...muster, site: undefined })}
            accent={CSS.hex}
            kicker="AS DESIGNED"
            title="ROTATION"
            children={
              "Boot Hill, then deeper, the ground changing under you every few " +
              "rounds. This is the run the game was built around."
            }
          />
          {SITES.map((site) => (
            <Card
              key={site.key}
              selected={muster.site === site.id}
              onSelect={() => onChange({ ...muster, site: site.id })}
              accent={site.id === SITE.undertown ? CSS.bell : CSS.lamp}
              kicker={`${site.width}×${site.depth}m · ${site.gates.length} GATE${
                site.gates.length === 1 ? "" : "S"
              }`}
              title={site.name}
              children={SITE_COPY[site.key] ?? "No survey filed."}
            />
          ))}
        </div>
        {muster.site !== undefined && (
          <p className="gh-menu-warn">
            The run stays here. Picking a map turns off the rotation — good for
            learning a site, and not how the curve was tuned.
          </p>
        )}
      </section>

      <section className="gh-menu-section">
        <h2 className="gh-menu-h">
          THE VIGIL
          <span className="gh-menu-note">cosmetic — they play identically</span>
        </h2>
        <div className="gh-picks">
          {HEROES.map((hero) => {
            const copy = HERO_COPY[hero.id];
            return (
              <Card
                key={hero.key}
                selected={muster.hero === hero.id}
                onSelect={() => onChange({ ...muster, hero: hero.id })}
                accent={copy.accent}
                kicker={hero.role.toUpperCase()}
                title={hero.name}
                children={
                  <>
                    <em className="gh-pick-quote">“{copy.line}”</em>
                    {copy.blurb}
                  </>
                }
              />
            );
          })}
        </div>
      </section>

      <footer className="gh-menu-foot">
        <button
          type="button"
          className="gh-play"
          onClick={onStart}
          disabled={booting}
        >
          {booting ? "WARMING SHADERS…" : "TAKE THE VIGIL"}
        </button>
        {best && best.round > 0 && (
          <span className="gh-menu-best">
            BEST · ROUND {best.round} · TALLY {best.tally.toLocaleString()}
          </span>
        )}
      </footer>
    </div>
  );
}
