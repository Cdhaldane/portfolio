/*
 * ui/App.tsx — the HUD and menus, in React 19.
 *
 * React lives OUTSIDE the frame loop (§12.2). The host publishes a plain snapshot
 * only when something the HUD shows has actually changed, so on most frames this
 * component does nothing at all; nothing here is ever called by the simulation,
 * and no three.js object is ever touched.
 */

import { useEffect, useRef, useState } from "react";

import { fetchBoard, type BoardState } from "../host/board.ts";
import { PHASE } from "../sim/world.ts";
import { ELEM } from "../sim/traps.ts";
import { DBG, type DbgAction } from "../sim/commands.ts";
import { ENEMIES } from "../sim/enemies.ts";
import { Game, type HudState, type HudSlot, type PerfState } from "../host/loop.ts";
import { CSS } from "../render/palette.ts";
import { defaultHeroId } from "../render/models/hero.ts";
import { renderTrapIcons, type TrapIcons } from "../render/icons.ts";
import Menu, { type Muster } from "./Menu.tsx";
import "./hud.css";

const SEED = 0x9be3ff;

/*
 * Element → swatch for the HUD.
 *
 * Tar uses `dust` here rather than its world-space `timberDark`: at hotbar size a
 * near-black glyph reads as *disabled*, so an affordable Tar Seep looked like one
 * you could not buy. The pool on the ground stays dark; only the icon is lifted.
 */
const ELEM_COLOR: Record<number, string> = {
  [ELEM.iron]: CSS.bone,
  [ELEM.tar]: CSS.dust,
  [ELEM.fire]: CSS.ember,
  [ELEM.powder]: CSS.lamp,
  [ELEM.arcane]: CSS.hex,
};

const ELEM_NAME: Record<number, string> = {
  [ELEM.iron]: "IRON",
  [ELEM.tar]: "TAR",
  [ELEM.fire]: "FIRE",
  [ELEM.powder]: "POWDER",
  [ELEM.arcane]: "ARCANE",
};

export default function App() {
  // The shelf is a *review* tool, not a game mode: it never constructs a World or
  // steps a tick (§17.9). Kept as a separate top-level branch so no shelf code can
  // run during play, and dynamically imported so it stays out of the play bundle.
  if (new URLSearchParams(location.search).has("shelf")) return <ShelfView />;
  return <Play />;
}

function Play() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [perf, setPerf] = useState<PerfState | null>(null);
  const [booting, setBooting] = useState(true);
  const [muted, setMuted] = useState(false);
  const [showPerf, setShowPerf] = useState(
    () => new URLSearchParams(location.search).has("dev"),
  );
  /**
   * The dev cheat menu (§19.2). Gated twice: the panel only exists under `?dev`,
   * and every button routes through CMD.debug, which taints the run and keeps it
   * off the leaderboard (host/loop.ts) — so leaving it open costs nothing until
   * something is actually clicked.
   */
  const isDev = new URLSearchParams(location.search).has("dev");
  const [showDev, setShowDev] = useState(false);
  /**
   * What the muster screen has chosen so far.
   *
   * Seeded from the URL so `?hero=ada` still selects a body — that was the
   * temporary mechanism HEROES.md §8 promised to replace, and honouring it here
   * means the capture harness and any existing bookmark keep working while the
   * menu becomes the real answer.
   */
  const [muster, setMuster] = useState<Muster>(() => ({
    hero: defaultHeroId(),
    site: undefined,
  }));
  /**
   * Bumped when the player commits to a choice they have already started under.
   *
   * The run has to begin on the world the menu was previewing, and the world is
   * rebuilt on every pick — so "start" simply takes pointer lock on the game
   * that is already running. Nothing is rebuilt at the moment of starting, which
   * is why there is no hitch between the last click and the first frame.
   */
  const [started, setStarted] = useState(false);
  /**
   * Bumped to force a fresh world when the player returns to the muster screen.
   *
   * Without it, abandoning a run and re-picking the same map would rebuild
   * nothing — the site-change effect would see identical deps — and "new run"
   * would silently drop the player back into the round they walked away from.
   */
  const [runId, setRunId] = useState(0);

  /*
   * The game is rebuilt when the SITE changes, which is what makes the card's
   * map preview the actual map (Menu.tsx §1). A site decides `createWorld`, so
   * there is genuinely no cheaper way to show one.
   *
   * The hero deliberately does NOT rebuild — see the effect below. Depending on
   * `muster.site` alone rather than on `muster` is the whole difference, and it
   * is easy to lose: `[muster]` looks more obviously correct and quietly tears
   * down a renderer every time someone clicks a hat.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setBooting(true);
    const game = new Game(canvas, SEED, { site: muster.site, hero: muster.hero });
    gameRef.current = game;
    game.onHud = setHud;
    game.onPerf = setPerf;

    let cancelled = false;
    void game.start().then(() => {
      if (!cancelled) setBooting(false);
    });

    setMuted(game.muted);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "F3" || (e.code === "Backquote" && !e.repeat)) {
        e.preventDefault();
        setShowPerf((v) => !v);
      }
      // The cheat menu. F4 because backquote is the perf overlay's. Opening it
      // releases pointer lock — a menu you cannot click is a screenshot.
      if (e.code === "F4" && !e.repeat && isDev) {
        e.preventDefault();
        setShowDev((v) => {
          if (!v) document.exitPointerLock?.();
          return !v;
        });
      }
      // Mute is presentation, not a sim command, so it never enters the replay.
      if (e.code === "KeyM" && !e.repeat) {
        e.preventDefault();
        setMuted(game.toggleMute());
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
      game.dispose();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the note above:
    // the hero is applied by `setHero`, not by rebuilding the world.
  }, [muster.site, runId]);

  /*
   * The hero is swapped in place instead. It is a render-only choice
   * (HEROES.md §6), so it costs one rig rebuild rather than a world, a level and
   * a WebGL context — which also makes flicking between the two Vigils instant,
   * and instant is how anyone actually compares them.
   */
  useEffect(() => {
    gameRef.current?.setHero(muster.hero);
  }, [muster.hero]);

  const locked = hud?.locked ?? false;
  const start = (): void => {
    setStarted(true);
    gameRef.current?.requestPointerLock();
  };

  /**
   * Back to the muster screen, on a fresh world.
   *
   * Bumping `runId` is the load-bearing half: returning to the menu has to
   * *end* the run, not pause it, or the next "take the vigil" would resume a
   * round the player had already abandoned — and the map preview behind the
   * cards would be showing a half-played site.
   */
  const toMuster = (): void => {
    setStarted(false);
    setRunId((n) => n + 1);
  };

  return (
    <div className="gh">
      <canvas ref={canvasRef} className="gh-canvas" />

      {hud && locked && <Hud hud={hud} />}
      {locked && muted && <div className="gh-muted">MUTED · M</div>}
      {showPerf && perf && <Perf perf={perf} />}
      {isDev && showDev && hud && (
        <DevMenu
          hud={hud}
          onCmd={(action, value) => gameRef.current?.debug(action, value)}
          onClose={() => setShowDev(false)}
        />
      )}

      {/*
        * The muster screen shows until the first time the player rings in; after
        * that, releasing the mouse returns to the run's own overlay — pause,
        * death, the record — which is where the way back to the menu lives.
        *
        * It is a *button on the pause card* rather than this branch flipping
        * back on its own, because leaving mid-run discards the run. Confirming
        * is the whole design: a menu that can silently throw away your best
        * round is a menu that gets clicked by accident.
        */}
      {!locked &&
        (started ? (
          <Overlay
            booting={booting}
            hud={hud}
            onPlay={start}
            onMuster={toMuster}
            onDownload={() => gameRef.current?.downloadReplay()}
          />
        ) : (
          <Menu
            muster={muster}
            onChange={setMuster}
            onStart={start}
            booting={booting}
            best={
              hud ? { round: hud.bestRound ?? 0, tally: hud.bestTally ?? 0 } : null
            }
          />
        ))}
    </div>
  );
}

/**
 * The dev cheat menu (§19.2) — `?dev` plus F4.
 *
 * Every button is a `CMD.debug` press into the command stream, so a cheated run
 * is still deterministic, still replayable, and still hash-checked; the sim
 * taints it (`debugUsed`) and the host keeps it off the leaderboard. The panel
 * reads its truth back off the HUD snapshot rather than tracking its own state,
 * so the toggles can never disagree with the sim about whether god mode is on.
 */
function DevMenu({
  hud,
  onCmd,
  onClose,
}: {
  hud: HudState;
  onCmd: (action: DbgAction, value?: number) => void;
  onClose: () => void;
}) {
  const [round, setRound] = useState("10");

  const jump = (): void => {
    const r = Math.max(1, Math.round(Number(round) || 1));
    onCmd(DBG.round, r);
  };

  return (
    <div className="gh-dev">
      <div className="gh-dev-head">
        <b>DEV</b>
        {hud.debugUsed && <span className="gh-dev-taint">off the board</span>}
        <button className="gh-dev-x" onClick={onClose} aria-label="close">
          ×
        </button>
      </div>

      <div className="gh-dev-readout">
        round {hud.round} · {hud.scrap} scrap · {hud.alive} up ·{" "}
        {hud.remaining} to come
      </div>

      <div className="gh-dev-row">
        <label>round</label>
        <input
          value={round}
          inputMode="numeric"
          onChange={(e) => setRound(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") jump();
            e.stopPropagation(); // typing must not fire game binds (Q/E/R…)
          }}
        />
        <button onClick={jump}>jump</button>
        {[1, 5, 8, 10, 20].map((r) => (
          <button key={r} onClick={() => onCmd(DBG.round, r)}>
            {r}
          </button>
        ))}
      </div>

      <div className="gh-dev-row">
        <label>scrap</label>
        <button onClick={() => onCmd(DBG.scrap, 1000)}>+1k</button>
        <button onClick={() => onCmd(DBG.scrap, 10000)}>+10k</button>
        <button
          data-on={hud.freeBuild || undefined}
          onClick={() => onCmd(DBG.freeBuild, hud.freeBuild ? 0 : 1)}
        >
          free build {hud.freeBuild ? "· ON" : ""}
        </button>
      </div>

      <div className="gh-dev-row">
        <label>vigil</label>
        <button
          data-on={hud.god || undefined}
          onClick={() => onCmd(DBG.god, hud.god ? 0 : 1)}
        >
          god {hud.god ? "· ON" : ""}
        </button>
        <button onClick={() => onCmd(DBG.heal)}>heal + vigil</button>
      </div>

      <div className="gh-dev-row">
        <label>wave</label>
        <button onClick={() => onCmd(DBG.killAll)}>kill all</button>
        <button onClick={() => onCmd(DBG.endRound)}>end round</button>
      </div>

      <div className="gh-dev-row gh-dev-spawn">
        <label>spawn</label>
        {ENEMIES.map((d) => (
          <button key={d.id} onClick={() => onCmd(DBG.spawn, d.id)}>
            {d.name.toLowerCase()}
          </button>
        ))}
      </div>

      <div className="gh-dev-note">
        F4 to toggle · any use keeps this run off the leaderboard
      </div>
    </div>
  );
}

/**
 * The debug room (§17.9): every asset in a row under game lighting.
 *
 * Dynamically imported so `render/shelf.ts` and the geometry it pulls in never
 * enter the bundle an actual player downloads (§19.2 applies the same rule to the
 * tweakpane panel).
 */
function ShelfView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let shelf: { start(): void; resize(): void; dispose(): void } | null = null;

    void import("../render/shelf.ts").then(({ Shelf }) => {
      if (disposed) return;
      shelf = new Shelf(canvas);
      shelf.start();
      setReady(true);
    });

    const onResize = () => shelf?.resize();
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      shelf?.dispose();
    };
  }, []);

  return (
    <div className="gh gh-shelf">
      <canvas ref={canvasRef} className="gh-canvas" />
      {ready && (
        <div className="gh-shelf-help">
          <strong>SHELF</strong> · drag orbit · wheel zoom · <kbd>S</kbd> silhouette ·{" "}
          <kbd>R</kbd> spin · <kbd>1</kbd>traps <kbd>2</kbd>enemies <kbd>3</kbd>hero{" "}
          <kbd>4</kbd>kit
        </div>
      )}
    </div>
  );
}

function Hud({ hud }: { hud: HudState }) {
  const vigilPct = (hud.vigil / hud.maxVigil) * 100;
  const hpPct = (hud.hp / hud.maxHp) * 100;
  const low = hud.vigil <= 5;
  const hurt = hud.hp <= hud.maxHp * 0.35;
  const building = hud.phase === PHASE.build;

  return (
    <>
      <div className="gh-crosshair" data-build={hud.buildMode || undefined}>
        <span />
        <span />
        <span />
        <span />
      </div>

      {/* Top-centre: the round. It's the score, so it's the biggest thing here. */}
      <div className="gh-round" data-elite={hud.eliteRound || undefined}>
        <span className="gh-round-label">ROUND</span>
        <span className="gh-round-num">{hud.round}</span>
        {hud.eliteRound && <span className="gh-round-tag">ELITE</span>}
        {hud.bestRound > 0 && (
          <span className="gh-round-best" data-beaten={hud.round > hud.bestRound || undefined}>
            {hud.round > hud.bestRound ? "NEW BEST" : `BEST ${hud.bestRound}`}
          </span>
        )}
      </div>

      <div className="gh-panel gh-panel--top">
        {building && (
          <span className="gh-bill">
            {hud.lastPayout > 0 && (
              <>
                PAID <b>+{hud.lastPayout}</b> ·{" "}
              </>
            )}
            NEXT: <b>{hud.roundQuota}</b> {hud.eliteRound ? "ELITE" : "DUSTKIN"} ·{" "}
            <kbd>F</kbd> RING THE BELL
          </span>
        )}
        {hud.phase === PHASE.combat && (
          <span className="gh-bill">
            <b>{hud.alive}</b> ON THE GROUND · <b>{hud.remaining}</b> STILL COMING
          </span>
        )}
        {hud.phase === PHASE.lost && (
          <span className="gh-bill gh-bill--bad">
            {hud.hp <= 0 ? "YOU WENT DOWN" : "THE RIFT IS OPEN"} · ROUND {hud.round} ·
            TALLY {hud.tally.toLocaleString()}
          </span>
        )}
      </div>

      {/* Bottom-left: the ledger. */}
      <div className="gh-panel gh-panel--bl">
        <div className="gh-vigil" data-low={low || undefined}>
          <span className="gh-label">VIGIL</span>
          <div className="gh-bar">
            <i style={{ width: `${vigilPct}%` }} />
          </div>
          <span className="gh-num">{hud.vigil}</span>
        </div>
        <div className="gh-vigil gh-vigil--hp" data-low={hurt || undefined}>
          <span className="gh-label">BLOOD</span>
          <div className="gh-bar">
            <i style={{ width: `${hpPct}%` }} />
          </div>
          <span className="gh-num">{hud.hp}</span>
        </div>
        <div className="gh-row">
          <span className="gh-label">SCRAP</span>
          <span className="gh-num gh-num--scrap">{hud.scrap}</span>
        </div>
      </div>

      {/* Bottom-right: the gun and the Boot. */}
      <div className="gh-panel gh-panel--br">
        <div className="gh-ammo" data-reloading={hud.reloading || undefined}>
          {Array.from({ length: hud.magazine }, (_, i) => (
            <i key={i} data-spent={i >= hud.ammo || undefined} />
          ))}
        </div>
        <span className="gh-weapon">
          {hud.reloading ? "RELOADING…" : hud.weaponName}
        </span>

        {/*
          * The two weapon abilities (§7.3). Placed with the gun rather than with
          * the hotbar because they belong to what is in your hands, not to what
          * you are about to build — the same reason the weapon took hotbar row 0.
          */}
        <div className="gh-abilities">
          {hud.abilities.map((a, i) => (
            <div
              key={a.key}
              className="gh-ability"
              data-ready={a.ready >= 1 || undefined}
              data-active={a.active || undefined}
            >
              <span className="gh-ability-key">{i === 0 ? "Q" : "E"}</span>
              <span className="gh-ability-name">{a.name}</span>
              {a.ready < 1 && <span className="gh-ability-cd">{a.secondsLeft}</span>}
              <div className="gh-ability-bar">
                <i style={{ width: `${Math.min(1, a.ready) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="gh-boot" data-ready={hud.bootReady >= 1 || undefined}>
          <span className="gh-boot-key">V</span>
          <span className="gh-boot-name">THE BOOT</span>
          <div className="gh-boot-bar">
            <i style={{ width: `${Math.min(1, hud.bootReady) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Right-centre: the tally and the hand in progress (§5). */}
      <div className="gh-tally">
        <span className="gh-tally-label">TALLY</span>
        <span className="gh-tally-num">{hud.tally.toLocaleString()}</span>
        {hud.handCount > 0 && (
          <div className="gh-hand">
            <div className="gh-hand-cards">
              {Array.from({ length: hud.handCount }, (_, i) => (
                <i key={i} />
              ))}
            </div>
            {hud.handName && (
              <span className="gh-hand-name">
                {hud.handName} <b>×{hud.handMultiplier}</b>
              </span>
            )}
          </div>
        )}
        {hud.handCount === 0 && hud.lastHandName && (
          <span className="gh-hand-stamp" key={hud.tally}>
            {hud.lastHandName} +{hud.lastHandPoints}
          </span>
        )}
      </div>

      <Hotbar hud={hud} />
    </>
  );
}

/**
 * The tally board.
 *
 * Renders nothing at all when the deployment has no database — `fetchBoard` answers
 * `configured: false` rather than failing, so a clone of this repo with no Neon URL
 * shows a title screen with no leaderboard and no explanation of why, which is the
 * correct amount of explanation.
 *
 * Fetched once when it mounts, never polled. The board changes when somebody
 * somewhere finishes a run; nobody is watching it live.
 */
function Board() {
  const [state, setState] = useState<BoardState | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchBoard().then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!state || !state.configured || state.entries.length === 0) return null;

  return (
    <div className="gh-board">
      <h3>THE TALLY BOARD</h3>
      <ol>
        {state.entries.slice(0, 8).map((e, i) => (
          <li key={`${e.name}-${e.created_at}`}>
            <span className="gh-board-rank">{i + 1}</span>
            <span className="gh-board-name">{e.name}</span>
            <span className="gh-board-round">R{e.round}</span>
            <span className="gh-board-tally">{e.tally.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Where a trap mounts, in two words or fewer.
 *
 * Shown on the slot itself rather than only in the tip: which surface a trap needs
 * is the first thing that decides whether you can afford to think about it, and
 * finding out after you have armed it and swept the walls for a green mark is a
 * worse way to learn (SURF order, sim/surfaces.ts).
 */
const SURFACE_TAG = ["", "WALL", "ROOF", "CHALK", "UNHALLOWED"] as const;

/**
 * The key that arms each trap slot, as the number row actually runs.
 *
 * Row index 0 is the revolver (`1`), so trap slot i is key i+2 — and past `0` the
 * row continues onto `-` and `=`, because ten traps plus the weapon need eleven
 * keys. A hint that stops at `0` leaves the last trap looking unbound.
 */
const SLOT_KEY = ["2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="] as const;

/*
 * Hotbar icons, rendered once per page load from the traps' own geometry
 * (render/icons.ts, decision 17).
 *
 * Module-scoped rather than component state because the Hotbar unmounts every
 * time pointer lock is released, and paying for a WebGL context on every pause
 * would be absurd for something that cannot change at runtime.
 *
 * Deferred past first paint: the hotbar draws immediately with its text glyphs
 * and swaps to icons a frame later, so creating the context never delays the
 * HUD appearing.
 */
let ICON_CACHE: TrapIcons | null = null;

function useTrapIcons(): TrapIcons {
  const [icons, setIcons] = useState<TrapIcons>(() => ICON_CACHE ?? {});
  useEffect(() => {
    if (ICON_CACHE) return;
    const id = requestAnimationFrame(() => {
      ICON_CACHE = renderTrapIcons();
      setIcons(ICON_CACHE);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return icons;
}

/**
 * The hotbar. Always visible, because in a trap game the loadout IS the
 * interface — and the synergy line under the armed slot is how a combo becomes
 * discoverable rather than a secret (§6).
 */
function Hotbar({ hud }: { hud: HudState }) {
  const icons = useTrapIcons();
  /*
   * §7 decision 17: row 0 is the revolver, rows 1..N are traps. The sim still
   * numbers traps from 0, so the selected ROW is derived rather than stored —
   * one less thing that can disagree with `hud.slot`.
   */
  const row = hud.buildMode ? hud.slot + 1 : 0;
  const armed: HudSlot | undefined = hud.slots[row];
  return (
    <div className="gh-hotbar">
      {/*
        * Standing on a placed trap swaps the tip for its two branches. §6 keeps
        * upgrades to exactly two and mutually exclusive, so the panel can show
        * BOTH trades in full — the decision is never hidden behind a submenu.
        */}
      {hud.buildMode && hud.upgradeTarget && (
        <div className="gh-upgrade">
          <span
            className="gh-upgrade-name"
            style={{ color: ELEM_COLOR[hud.upgradeTarget.elem] }}
          >
            {hud.upgradeTarget.trapName}
          </span>
          <div className="gh-upgrade-opts">
            {hud.upgradeTarget.options.map((o, i) => (
              <div
                className="gh-upgrade-opt"
                key={o.name}
                data-poor={!hud.upgradeTarget!.affordable || undefined}
              >
                <span className="gh-upgrade-key">{i === 0 ? "Z" : "X"}</span>
                <span className="gh-upgrade-opt-name">{o.name}</span>
                <span className="gh-upgrade-blurb">{o.blurb}</span>
              </div>
            ))}
          </div>
          <span
            className="gh-upgrade-cost"
            data-poor={!hud.upgradeTarget.affordable || undefined}
          >
            {hud.upgradeTarget.cost} SCRAP · <kbd>RMB</kbd> SELL
          </span>
        </div>
      )}

      {hud.buildMode && hud.upgradedAs && (
        <div className="gh-upgrade gh-upgrade--done">
          <span className="gh-upgrade-name">{hud.upgradedAs}</span>
          <span className="gh-upgrade-cost">
            ALREADY CHOSEN · <kbd>RMB</kbd> SELL
          </span>
        </div>
      )}

      {hud.buildMode && armed && !hud.upgradeTarget && !hud.upgradedAs && (
        <div className="gh-hotbar-tip">
          <span className="gh-hotbar-tip-name" style={{ color: ELEM_COLOR[armed.elem] }}>
            {armed.name}
          </span>
          <span className="gh-hotbar-tip-syn">{armed.synergy}</span>
          {armed.surface !== 0 && (
            <span className="gh-hotbar-tip-mount">
              {armed.surface === 2
                ? "Mounts overhead — aim at a marked roof beam."
                : armed.surface === 1
                  ? "Bolts to a wall — aim at a marked face."
                  : "Traced on chalk — aim at a marked circle."}
            </span>
          )}
          <span className="gh-hotbar-tip-keys">
            {hud.onExistingTrap ? (
              <>
                <kbd>RMB</kbd> SELL
              </>
            ) : (
              <>
                <kbd>LMB</kbd> SET · <kbd>RMB</kbd> SELL · <kbd>1</kbd> GUN
              </>
            )}
          </span>
        </div>
      )}

      {hud.denyReason && (
        /* Under the crosshair, not in a corner: it answers a question the player is
           asking *right now*, about the thing they are pointing at. */
        <p className="gh-deny">{hud.denyReason}</p>
      )}

      <div className="gh-slots">
        {hud.slots.map((s, i) => {
          const icon = s.icon ? icons[s.icon] : undefined;
          return (
            <button
              key={s.name}
              type="button"
              className="gh-slot"
              data-kind={s.kind}
              data-armed={(i === row && (s.kind === "weapon" || hud.buildMode)) || undefined}
              data-selected={i === row || undefined}
              data-poor={!s.affordable || undefined}
              style={{ "--elem": ELEM_COLOR[s.elem] } as React.CSSProperties}
              tabIndex={-1}
            >
              {/* 1..9 then 0 — the tenth key, once a hotbar outgrows one row. */}
              <span className="gh-slot-key">{SLOT_KEY[i] ?? ""}</span>
              {/*
               * The icon is rendered from the trap's own geometry at boot
               * (render/icons.ts). The glyph stays as the fallback for the frame
               * before the atlas exists, and for the weapon row which has no
               * placeable model.
               */}
              {icon ? (
                <img className="gh-slot-icon" src={icon} alt="" draggable={false} />
              ) : (
                <span className="gh-slot-glyph">{s.glyph}</span>
              )}
              {s.kind === "trap" ? (
                <>
                  <span className="gh-slot-cost">{s.cost}</span>
                  <span className="gh-slot-elem">{ELEM_NAME[s.elem]}</span>
                  {s.surface !== 0 && (
                    <span className="gh-slot-surface">{SURFACE_TAG[s.surface]}</span>
                  )}
                </>
              ) : (
                <span className="gh-slot-elem">GUN</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Perf({ perf }: { perf: PerfState }) {
  // Green/amber/red against the SCALED budget, not 16.6ms (§22 R20).
  const load = (perf.frameMs / perf.budgetMs) * perf.scale;
  const state = load < 0.75 ? "ok" : load < 1 ? "warn" : "bad";
  return (
    <div className="gh-perf" data-state={state}>
      <div className="gh-perf-row">
        <b>{perf.fps.toFixed(0)}</b> fps · {perf.frameMs.toFixed(2)}ms
      </div>
      <div className="gh-perf-row">
        sim {perf.simMs.toFixed(2)}ms · render {perf.renderMs.toFixed(2)}ms
      </div>
      <div className="gh-perf-row">
        {perf.drawCalls} calls · {(perf.triangles / 1000).toFixed(0)}k tris
      </div>
      <div className="gh-perf-row">
        {perf.entities} entities · {perf.ticks} tick{perf.ticks === 1 ? "" : "s"}/frame
      </div>
      <div className="gh-perf-row gh-perf-budget">
        budget {perf.budgetMs.toFixed(1)}ms ({(perf.scale * 100) | 0}% — 3070 vs median iGPU)
      </div>
    </div>
  );
}

function Overlay({
  booting,
  hud,
  onPlay,
  onMuster,
  onDownload,
}: {
  booting: boolean;
  hud: HudState | null;
  onPlay: () => void;
  onMuster: () => void;
  onDownload: () => void;
}) {
  const dead = hud?.phase === PHASE.lost;
  const best = hud?.bestRound ?? 0;
  /*
   * Two-step confirm, but only while the run is still alive.
   *
   * Leaving mid-run discards it, and this card is one keypress from the game —
   * Escape releases the mouse, so the player arrives here constantly, mid-round,
   * just to think. A single-click "back to menu" sitting next to "resume" would
   * eventually eat somebody's best round.
   *
   * Once dead there is nothing left to lose, so the same button is a plain,
   * unconfirmed "new run" — asking "are you sure?" about a run that is already
   * over is the kind of dialogue that trains people to click through dialogues.
   */
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="gh-overlay">
      <div className="gh-overlay-card">
        <span className="gh-kicker" style={{ color: CSS.ember }}>
          M0 · VERTICAL PROOF
        </span>
        <h1 className="gh-title">GALLOWS HYMN</h1>
        <p className="gh-sub">
          {booting
            ? "WARMING SHADERS…"
            : dead
              ? `Round ${hud?.round}. Tally ${hud?.tally.toLocaleString()}. Take it up again when you're ready.`
              : hud && hud.round > 1
                ? `Round ${hud.round} is posted. Spend the scrap, then ring the bell.`
                : "Wire the ground. Ring the bell. Stand in it."}
        </p>

        {/*
          * The record, persisted (§18.3). The whole design rests on "the highest
          * round is the score", so the score has to outlive the tab — and a
          * personal best is what makes one more run worth starting.
          */}
        {best > 0 && (
          <dl className="gh-record">
            <div>
              <dt>BEST ROUND</dt>
              <dd data-new={hud?.newBestRound || undefined}>{best}</dd>
            </div>
            <div>
              <dt>BEST TALLY</dt>
              <dd data-new={hud?.newBestTally || undefined}>
                {(hud?.bestTally ?? 0).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>VIGILS KEPT</dt>
              <dd>{hud?.runsPlayed ?? 0}</dd>
            </div>
          </dl>
        )}

        {dead && hud?.banked && (
          /* Quiet on purpose. A leaderboard on a hidden page should confirm it took
             the run and otherwise stay out of the way — and when there is no database
             configured this simply never appears, rather than explaining itself. */
          <p className="gh-banked">TALLIED ON THE BOARD</p>
        )}

        <Board />

        {dead && (hud?.newBestRound || hud?.newBestTally) && (
          <p className="gh-newbest">
            {hud?.newBestRound && hud?.newBestTally
              ? "A NEW BEST, BOTH WAYS"
              : hud?.newBestRound
                ? "DEEPEST YOU HAVE HELD"
                : "YOUR RICHEST LEDGER YET"}
          </p>
        )}

        <div className="gh-actions">
          <button
            className="gh-play"
            onClick={() => {
              setConfirming(false);
              onPlay();
            }}
            disabled={booting}
          >
            {booting ? "…" : dead ? "LOOK AWAY" : "TAKE THE VIGIL"}
          </button>

          <button
            className="gh-secondary"
            data-confirm={confirming || undefined}
            onClick={() => {
              if (dead || confirming) onMuster();
              else setConfirming(true);
            }}
          >
            {dead ? "NEW RUN" : confirming ? "ABANDON IT?" : "MUSTER"}
            <span>
              {dead
                ? "pick ground & Vigil"
                : confirming
                  ? "this round is lost"
                  : "change ground or Vigil"}
            </span>
          </button>

          {dead && (hud?.replayBytes ?? 0) > 0 && (
            <button className="gh-secondary" onClick={onDownload}>
              SAVE REPLAY
              <span>{Math.max(1, Math.round((hud?.replayBytes ?? 0) / 1024))} KB</span>
            </button>
          )}
        </div>

        <dl className="gh-keys">
          <div>
            <dt>WASD</dt>
            <dd>move</dd>
          </div>
          <div>
            <dt>SPACE</dt>
            <dd>jump</dd>
          </div>
          <div>
            <dt>SHIFT</dt>
            <dd>sprint</dd>
          </div>
          <div>
            <dt>LMB</dt>
            <dd>fire / set</dd>
          </div>
          <div>
            <dt>RMB</dt>
            <dd>aim / sell</dd>
          </div>
          <div>
            <dt>R</dt>
            <dd>reload</dd>
          </div>
          <div>
            <dt>E</dt>
            <dd>the boot</dd>
          </div>
          <div>
            <dt>1–5</dt>
            <dd>arm trap</dd>
          </div>
          <div>
            <dt>WHEEL</dt>
            <dd>cycle traps</dd>
          </div>
          <div>
            <dt>Q</dt>
            <dd>holster</dd>
          </div>
          <div>
            <dt>F</dt>
            <dd>start round</dd>
          </div>
          <div>
            <dt>ESC</dt>
            <dd>release mouse</dd>
          </div>
          <div>
            <dt>M</dt>
            <dd>mute</dd>
          </div>
          <div>
            <dt>`</dt>
            <dd>perf</dd>
          </div>
        </dl>

        <p className="gh-foot">
          Tar soaks them. Brimstone lights the tar for triple. Jaws holds them in
          it. <b>The Boot</b> kicks them back into all of it — and a trap finishing
          what you kicked scores double.
        </p>
      </div>
    </div>
  );
}
