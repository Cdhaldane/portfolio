/*
 * host/loop.ts — the fixed-timestep loop from §12.3, and the only place that
 * knows about wall-clock time.
 *
 * The accumulator pattern with a catch-up ceiling is what makes the simulation
 * frame-rate independent AND replay-safe: the sim only ever advances in whole
 * 60Hz ticks, no matter what the display or the tab does.
 */

import { Vector3 } from "three";

import {
  cellOfSlot,
  isPlaceableFor,
  slotOfCell,
  tileOf,
  wouldSealLane,
} from "../sim/level.ts";
import { SURF, slotNearRay } from "../sim/surfaces.ts";
import { step } from "../sim/step.ts";
import { BOOT, MAX_CATCHUP_STEPS, OBJECTIVE, REVOLVER, ROUND, STEP } from "../sim/tuning.ts";
import { siteForRound } from "../sim/sites.ts";
import type { HeroId } from "../render/models/hero.ts";
import { HANDS, evaluate, type HandId } from "../sim/combo.ts";
import { TRAPS, upgradeCost } from "../sim/traps.ts";
import { trapCost } from "../sim/systems/command.ts";
import { PHASE, createWorld, isEliteRound, trapAtCell, type World } from "../sim/world.ts";
import { Renderer } from "../render/scene.ts";
import { Audio } from "../audio/index.ts";
import { Recorder, encode, sizeBytes, type Replay } from "../sim/replay.ts";
import { loadProfile, recordRun, saveProfile, type Profile } from "./persist.ts";
import { Input } from "./input.ts";

/** One hotbar slot, as the HUD sees it. */
export interface HudSlot {
  /**
   * Row 0 is the revolver; the rest are traps (§7 decision 17). The hotbar is
   * "everything that can be in your hands", so the weapon is a row rather than a
   * mode you leave with a different kind of key.
   */
  kind: "weapon" | "trap";
  glyph: string;
  name: string;
  cost: number;
  elem: number;
  synergy: string;
  affordable: boolean;
  /** Where it mounts. The hotbar has to say so — see sim/surfaces.ts. */
  surface: number;
  /** Model key for the generated icon (render/icons.ts). Empty for the weapon. */
  icon: string;
}

/** What the HUD needs. Plain data, published only when it changes. */
export interface HudState {
  phase: number;
  round: number;
  hp: number;
  maxHp: number;
  tally: number;
  /** Kills in the hand currently building, and its provisional name. */
  handCount: number;
  handName: string;
  handMultiplier: number;
  /** The hand that last closed, for the stamp. */
  lastHandName: string;
  lastHandPoints: number;
  /** 0..1, 1 = ready. */
  bootReady: number;
  /** Persisted across sessions (§18.3), so a run means something. */
  bestRound: number;
  bestTally: number;
  runsPlayed: number;
  newBestRound: boolean;
  newBestTally: boolean;
  /** Set once the run has ended and a replay exists to download. */
  replayBytes: number;
  highestRound: number;
  eliteRound: boolean;
  vigil: number;
  maxVigil: number;
  scrap: number;
  ammo: number;
  magazine: number;
  reloading: boolean;
  kills: number;
  leaks: number;
  alive: number;
  remaining: number;
  roundQuota: number;
  buildMode: boolean;
  canPlace: boolean;
  onExistingTrap: boolean;
  /** Set when the crosshair is on a trap that can still be upgraded. */
  upgradeTarget: {
    trapName: string;
    elem: number;
    cost: number;
    affordable: boolean;
    options: { name: string; blurb: string }[];
  } | null;
  /** Set when the crosshair is on a trap that already took a branch. */
  upgradedAs: string | null;
  slot: number;
  slots: HudSlot[];
  lastPayout: number;
  locked: boolean;
  accuracy: number;
}

export interface PerfState {
  fps: number;
  frameMs: number;
  simMs: number;
  renderMs: number;
  drawCalls: number;
  triangles: number;
  entities: number;
  ticks: number;
  /** Fraction of the median-machine GPU budget this machine should be held to. */
  scale: number;
  budgetMs: number;
}

/**
 * §22 R20: an RTX 3070 is ~4–6× a typical integrated GPU, so a frame that costs
 * 10ms on the target machine costs ~3ms here. Judging the profiler against 16.6ms
 * on dev hardware is actively misleading — everything reads green until someone
 * else opens the game. The overlay colours against this instead.
 */
const PERF_SCALE = 0.3;
const TARGET_FRAME_MS = 16.6;

/**
 * What the muster screen chose (`ui/Menu.tsx`).
 *
 * Both are optional and both default to what the game did before the menu
 * existed, which is the property that matters: the smoke test, the capture
 * harness and a bare `/hymn/` URL all still boot straight into Boot Hill with
 * Amos, and nothing had to learn about a menu to keep working.
 *
 * `site` being *present* is what locks the run to that ground — omitting it
 * means §4's rotation, which is the designed run.
 */
export interface RunOptions {
  site?: number;
  hero?: HeroId;
}

export class Game {
  readonly world: World;
  private renderer: Renderer;
  private audio = new Audio();
  private input: Input;
  /** Last hand size seen, so a new card can be heard as it lands. */
  private lastHandCount = 0;
  private recorder: Recorder;
  private profile: Profile;
  /** Set exactly once, when the run ends. */
  private replay: Replay | null = null;
  private newBestRound = false;
  private newBestTally = false;
  private saved = false;
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private running = false;
  private aimPoint = new Vector3();
  /** ox, oy, oz, dx, dy, dz — reused every frame. */
  private aimRay = new Float64Array(6);
  private aimCell = -1;
  private canPlace = false;
  private onExistingTrap = false;
  private lastHudSig = "";

  // Rolling perf, EMA-smoothed so the numbers are readable.
  private simMs = 0;
  private renderMs = 0;
  private frameMs = 16;
  private stepsThisFrame = 0;
  private frameCount = 0;
  /** Milliseconds of remaining hit stop. */
  private hitStop = 0;

  onHud: ((hud: HudState) => void) | null = null;
  onPerf: ((perf: PerfState) => void) | null = null;
  onPause: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, seed: number, run: RunOptions = {}) {
    const site = run.site ?? siteForRound(ROUND.firstRound);
    const locked = run.site !== undefined;
    this.world = createWorld(seed, site, locked);
    this.recorder = new Recorder(seed, performance.now(), site, locked);
    this.profile = loadProfile();
    this.renderer = new Renderer(canvas, this.world, run.hero);
    this.input = new Input(
      canvas,
      this.world.player.yaw,
      this.world.player.pitch,
    );
    this.input.onPause = () => this.onPause?.();
    window.addEventListener("resize", this.handleResize);
  }

  private handleResize = (): void => {
    this.renderer.resize();
  };

  async start(): Promise<void> {
    // Compile every shader before the first frame so the first muzzle flash
    // doesn't cost 200ms (§22 R4).
    await this.renderer.warmUp();
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  requestPointerLock(): void {
    // A user gesture is the only moment a browser will let an AudioContext start,
    // which is precisely why the game asks for a click before it plays.
    this.audio.resume();
    this.input.requestLock();
  }

  toggleMute(): boolean {
    return this.audio.toggleMute();
  }

  get muted(): boolean {
    return this.audio.isMuted;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const rawDt = (now - this.last) / 1000;
    this.last = now;
    // Clamp: a backgrounded tab must not deliver a 30-second dt.
    const dt = Math.min(rawDt, 0.25);
    this.frameMs += ((rawDt * 1000) - this.frameMs) * 0.1;

    this.input.buildMode = this.world.player.buildMode;
    this.input.slot = this.world.player.slot;
    this.input.onUpgradable = this.upgradeTarget() !== null;
    this.input.aimCell = this.aimCell;
    this.input.sample();

    /*
     * Hit stop (§14.6): freeze the SIM for a few tens of milliseconds while
     * presentation keeps running, so a heavy hit lands instead of merely
     * happening.
     *
     * It scales the accumulator, never the sim step. The tick sequence is
     * untouched, so a replay of this run is bit-identical whether or not hit stop
     * fired — feel must never be paid for with determinism (§13).
     */
    if (this.renderer.hitStopRequest > 0) {
      this.hitStop = Math.max(this.hitStop, this.renderer.hitStopRequest);
      this.renderer.hitStopRequest = 0;
    }
    let simDt = dt;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - dt * 1000);
      simDt = 0;
    }

    // ── simulate ──────────────────────────────────────────────────────────
    this.accumulator += simDt;
    let steps = 0;
    const simStart = performance.now();
    while (this.accumulator >= STEP && steps < MAX_CATCHUP_STEPS) {
      const input = this.input.buffer.take(this.world.tick);
      // Record before stepping and fingerprint before mutating: a replay has to
      // capture exactly what the sim was handed (§13 rule 7).
      this.recorder.checkpoint(this.world);
      this.recorder.record(input);
      step(this.world, input);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_CATCHUP_STEPS) {
      // Never accumulate debt: drop the remainder rather than fall further behind.
      this.accumulator = 0;
    }
    this.stepsThisFrame = steps;
    this.frameCount++;
    this.simMs += (performance.now() - simStart - this.simMs) * 0.1;

    // ── present ───────────────────────────────────────────────────────────
    const alpha = this.accumulator / STEP;
    const renderStart = performance.now();
    this.renderer.consumeEvents(this.world);

    /*
     * What is the crosshair pointing at? Resolved before render so the ghost and
     * the click that places a trap can never disagree about the target.
     *
     * The armed trap decides how aim is interpreted: a floor trap wants the ground
     * cell under the crosshair, while a wall or roof trap wants the nearest
     * authored mount you are looking at (MAPS §9 item 5). Same `aimCell` field
     * either way — mounts live in the `SLOT_BASE` id range.
     */
    const armed = TRAPS[this.world.player.slot];
    const surface = armed ? armed.surface : SURF.floor;
    if (surface === SURF.floor) {
      if (this.renderer.aimPoint(this.aimPoint)) {
        this.aimCell = tileOf(this.world.level, this.aimPoint.x, this.aimPoint.z);
      } else {
        this.aimCell = -1;
      }
    } else {
      const r = this.renderer.aimRayInto(this.aimRay);
      const slot = r
        ? slotNearRay(
            this.world.level.slots,
            surface,
            this.aimRay[0],
            this.aimRay[1],
            this.aimRay[2],
            this.aimRay[3],
            this.aimRay[4],
            this.aimRay[5],
            (i) => trapAtCell(this.world, cellOfSlot(i)) >= 0,
          )
        : -1;
      this.aimCell = slot < 0 ? -1 : cellOfSlot(slot);
    }
    const existing = this.aimCell >= 0 ? trapAtCell(this.world, this.aimCell) : -1;
    this.onExistingTrap = existing >= 0;
    this.canPlace =
      this.aimCell >= 0 &&
      isPlaceableFor(this.world.level, this.aimCell, surface) &&
      existing < 0 &&
      this.world.scrap >= trapCost(this.world, this.world.player.slot) &&
      /*
       * An obstacle that would seal a lane reads red before the click, not after.
       * `wouldSealLane` is pure precisely so the render path may ask it every frame
       * without touching sim state (§12.2) — see the purity test in blockade.test.ts.
       */
      !(armed?.blocks === true && wouldSealLane(this.world.level, this.aimCell));

    this.renderer.render(this.world, alpha, dt, this.aimCell, this.canPlace);
    this.renderMs += (performance.now() - renderStart - this.renderMs) * 0.1;

    // ── audio ─────────────────────────────────────────────────────────────
    // Both presentation layers have now read the ring, so the host clears it.
    this.audio.setListener(this.renderer.listener(this.world));
    this.audio.consumeEvents(this.world.events);
    this.world.events.clear();

    // A card per kill in the open hand: heard as it lands, not when it banks.
    const hand = this.world.hand.count;
    if (hand > this.lastHandCount) this.audio.cardFlip();
    this.lastHandCount = hand;

    this.maybeFinishRun();

    const combat = this.world.phase === PHASE.combat;
    const pressure = Math.min(1, this.world.enemies.count / 10);
    this.audio.update(dt, pressure, combat, this.world.phase === PHASE.lost);

    this.publish();
  };

  /**
   * The HUD is republished only when something it shows actually changed. React
   * then costs ~0 on the vast majority of frames, which is what lets §14.1 budget
   * 0.2ms for it — a 60Hz setState would blow that on its own.
   */
  /**
   * Seal the replay and bank the run, exactly once.
   *
   * Done here rather than inside the sim because a *run ending* is a presentation
   * and persistence concern — the simulation's job finished when it set
   * `PHASE.lost`, and giving it a localStorage dependency would break every
   * headless test in `tests/`.
   */
  private maybeFinishRun(): void {
    if (this.saved || this.world.phase !== PHASE.lost) return;
    this.saved = true;

    this.replay = this.recorder.finish(this.world, performance.now());
    const result = recordRun(this.profile, this.replay.outcome, this.world.seed);
    this.profile = result.profile;
    this.newBestRound = result.newBestRound;
    this.newBestTally = result.newBestTally;
    saveProfile(this.profile);
    // Force a republish so the death screen can show the new best immediately.
    this.lastHudSig = "";
  }

  /** Download the finished run as a `.ghreplay` file (§13: seed + command log). */
  downloadReplay(): void {
    if (!this.replay) return;
    const blob = new Blob([encode(this.replay)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gallows-hymn-r${this.replay.outcome.round}-${this.replay.seed}.ghreplay`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** The two branches on offer for whatever the crosshair is on. */
  private upgradeTarget(): HudState["upgradeTarget"] {
    const w = this.world;
    if (!w.player.buildMode || this.aimCell < 0) return null;
    const id = trapAtCell(w, this.aimCell);
    if (id < 0 || w.traps.upgrade[id] !== 0) return null;
    const def = TRAPS[w.traps.defId[id]];
    // No branches, no panel: an empty upgrade card reads as a bug (§6).
    if (def.upgrades === undefined) return null;
    const cost = upgradeCost(def.id);
    return {
      trapName: def.name,
      elem: def.elem,
      cost,
      affordable: w.scrap >= cost,
      options: (def.upgrades ?? []).map((u) => ({ name: u.name, blurb: u.blurb })),
    };
  }

  private upgradedAs(): string | null {
    const w = this.world;
    if (!w.player.buildMode || this.aimCell < 0) return null;
    const id = trapAtCell(w, this.aimCell);
    if (id < 0 || w.traps.upgrade[id] === 0) return null;
    const def = TRAPS[w.traps.defId[id]];
    return def.upgrades?.[w.traps.upgrade[id] - 1]?.name ?? null;
  }

  private hudSignature(): string {
    const w = this.world;
    const p = w.player;
    return [
      w.phase,
      w.round,
      w.vigil,
      w.scrap,
      p.ammo,
      p.reloadTicks > 0 ? 1 : 0,
      w.kills,
      w.leaks,
      w.enemies.count,
      w.spawnedThisWave,
      Math.ceil(w.player.hp),
      w.tally,
      w.hand.count,
      w.lastHand,
      w.player.bootCooldown > 0 ? 1 : 0,
      p.buildMode ? 1 : 0,
      p.slot,
      this.canPlace ? 1 : 0,
      this.onExistingTrap ? 1 : 0,
      this.aimCell,
      this.input.isLocked ? 1 : 0,
      this.saved ? 1 : 0,
    ].join(",");
  }

  private buildSlots(): HudSlot[] {
    const w = this.world;
    const p = w.player;
    /* Row 0 is the gun. It costs nothing and is always affordable, which is the
     * point: it is the one row that can never be greyed out. */
    const out: HudSlot[] = [
      {
        kind: "weapon",
        glyph: "REV",
        name: "ABSOLUTION",
        cost: 0,
        elem: TRAPS[0].elem,
        synergy: `${p.ammo} / ${REVOLVER.magazine} · ${p.reloadTicks > 0 ? "RELOADING" : "READY"}`,
        affordable: true,
        surface: -1,
        icon: "",
      },
    ];
    for (let i = 0; i < TRAPS.length; i++) {
      const def = TRAPS[i];
      out.push({
        kind: "trap",
        glyph: def.glyph,
        name: def.name,
        cost: trapCost(w, def.id),
        elem: def.elem,
        synergy: def.synergy,
        affordable: w.scrap >= trapCost(w, def.id),
        surface: def.surface,
        icon: def.key,
      });
    }
    return out;
  }

  private publish(): void {
    const w = this.world;
    const p = w.player;

    const sig = this.hudSignature();
    if (sig !== this.lastHudSig) {
      this.lastHudSig = sig;
      const provisional = evaluate(w.hand);
      this.onHud?.({
        phase: w.phase,
        round: w.round,
        hp: Math.ceil(p.hp),
        maxHp: p.maxHp,
        tally: w.tally,
        handCount: w.hand.count,
        handName: HANDS[provisional].name,
        handMultiplier: HANDS[provisional].multiplier,
        lastHandName: HANDS[w.lastHand as HandId].name,
        lastHandPoints: w.lastHandPoints,
        bootReady: 1 - p.bootCooldown / Math.max(1, BOOT.cooldown),
        bestRound: this.profile.bestRound,
        bestTally: this.profile.bestTally,
        runsPlayed: this.profile.runsPlayed,
        newBestRound: this.newBestRound,
        newBestTally: this.newBestTally,
        replayBytes: this.replay ? sizeBytes(this.replay) : 0,
        highestRound: w.highestRound,
        eliteRound: isEliteRound(w.round),
        vigil: w.vigil,
        maxVigil: OBJECTIVE.startingVigil,
        scrap: w.scrap,
        ammo: p.ammo,
        magazine: REVOLVER.magazine,
        reloading: p.reloadTicks > 0,
        kills: w.kills,
        leaks: w.leaks,
        alive: w.enemies.count,
        remaining: Math.max(0, w.roundQuota - w.spawnedThisWave),
        roundQuota: w.roundQuota,
        buildMode: p.buildMode,
        canPlace: this.canPlace,
        onExistingTrap: this.onExistingTrap,
        upgradeTarget: this.upgradeTarget(),
        upgradedAs: this.upgradedAs(),
        slot: p.slot,
        slots: this.buildSlots(),
        lastPayout: w.lastPayout,
        locked: this.input.isLocked,
        accuracy: w.shotsFired > 0 ? w.shotsHit / w.shotsFired : 0,
      });
    }

    const stats = this.renderer.stats();
    const audioStats = this.audio.stats();

    /*
     * A tiny always-on machine-readable hook (the dev overlay is the human one).
     *
     * `scripts/smoke-game.mjs` asserts against it because a WebGL canvas will not
     * hand back its pixels without `preserveDrawingBuffer`, so "did it draw?" has
     * to be answered by the renderer rather than by sampling the framebuffer.
     *
     * `scripts/capture-game.mjs` needs the aim fields for a different reason:
     * under pointer lock the mouse reports only deltas, and headless Chrome's
     * synthetic moves do not map cleanly onto view rotation. Exposing which grid
     * cell the crosshair is on lets the capture harness close the loop and aim at
     * a specific trap instead of guessing screen coordinates.
     */
    (window as unknown as { __gallowsHymn?: Record<string, number | string> }).__gallowsHymn = {
      frame: this.frameCount,
      tick: w.tick,
      phase: w.phase,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      entities: w.enemies.count + w.traps.count,
      aimCell: this.aimCell,
      trapAt: this.aimCell >= 0 ? trapAtCell(w, this.aimCell) : -99,
      trapCell0: w.traps.count > 0 ? w.traps.cell[0] : -99,
      buildMode: p.buildMode ? 1 : 0,
      /* Mount placement, for scripts/verify-mounts.mjs. `aimCell` above already
         reports a mount as its SLOT_BASE id, so `aimSlot` is just the decoded
         form; `mountSlots` is how many the site offers for the armed class, which
         is the number the chalk marks should agree with. */
      aimSlot: slotOfCell(this.aimCell),
      marks: this.renderer.marksShown,
      mountSlots: this.world.level.slots.filter(
        (sl) => sl.surface === (TRAPS[p.slot]?.surface ?? SURF.floor),
      ).length,
      mounted: (() => {
        let n = 0;
        for (let i = 0; i < w.traps.alive.length; i++) {
          if (w.traps.alive[i] && w.traps.y[i] > 0) n++;
        }
        return n;
      })(),
      upg: this.upgradeTarget() ? 1 : 0,
      audio: audioStats.state,
      voices: audioStats.voices,
      voicePeak: audioStats.peak,
      muted: audioStats.muted ? 1 : 0,
      sounds: audioStats.played,
    };

    this.onPerf?.({
      fps: 1000 / Math.max(0.001, this.frameMs),
      frameMs: this.frameMs,
      simMs: this.simMs,
      renderMs: this.renderMs,
      drawCalls: stats.drawCalls,
      triangles: stats.triangles,
      entities: w.enemies.count + w.traps.count,
      ticks: this.stepsThisFrame,
      scale: PERF_SCALE,
      budgetMs: TARGET_FRAME_MS * PERF_SCALE,
    });
  }

  /**
   * Change which Vigil is on screen, mid-session, without disturbing the run.
   *
   * Safe at any time because the hero body is presentation only (HEROES.md §6:
   * the two are mechanically identical), so this touches no simulation state and
   * never enters the replay.
   */
  setHero(hero: HeroId): void {
    this.renderer.setHero(hero);
  }

  dispose(): void {
    this.running = false;
    this.audio.dispose();
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.handleResize);
    this.input.dispose();
    this.renderer.dispose();
  }
}
