/*
 * audio/index.ts — the mixer, and the event→sound mapping.
 *
 * The §16 graph: four buses (SFX / MUSIC / UI / AMBIENCE) into a master
 * compressor. Buses exist so the music can be ducked under the Bell and so a
 * volume slider means something later; the compressor exists because forty
 * simultaneous bodies will otherwise clip the master on every wave.
 *
 * Audio is a *read* of the simulation's event stream and nothing else — it never
 * calls into the sim, and the sim has no idea it exists (§12.2). That is why a
 * silent build and a loud build are the same run.
 */

import { EV, type EventRing } from "../sim/events.ts";
import { Music } from "./music.ts";
import {
  CULL_DISTANCE,
  PRIORITY,
  allocate,
  gainFor,
  makeSlots,
  occupy,
  panFor,
  release,
  type VoiceSlot,
} from "./pool.ts";
import { SFX, render, type SfxId } from "./synth.ts";

const STORAGE_KEY = "gh-muted";

/** Per-sound routing: which bus, how loud, and how hard it fights for a voice. */
interface SoundSpec {
  bus: "sfx" | "ui";
  gain: number;
  priority: number;
  /** Positional sounds are panned and attenuated; UI and player sounds are not. */
  positional: boolean;
}

const SPEC: Record<number, SoundSpec> = {
  [SFX.revolver]: { bus: "sfx", gain: 0.5, priority: PRIORITY.player, positional: false },
  [SFX.dryFire]: { bus: "sfx", gain: 0.4, priority: PRIORITY.player, positional: false },
  [SFX.reloadClick]: { bus: "sfx", gain: 0.4, priority: PRIORITY.player, positional: false },
  [SFX.reloadDone]: { bus: "sfx", gain: 0.4, priority: PRIORITY.player, positional: false },
  [SFX.bootThud]: { bus: "sfx", gain: 0.6, priority: PRIORITY.player, positional: false },
  [SFX.abilityFire]: { bus: "sfx", gain: 0.55, priority: PRIORITY.player, positional: false },
  [SFX.abilityDenied]: { bus: "sfx", gain: 0.3, priority: PRIORITY.player, positional: false },
  [SFX.fanShot]: { bus: "sfx", gain: 0.5, priority: PRIORITY.player, positional: false },
  [SFX.kegThrow]: { bus: "sfx", gain: 0.4, priority: PRIORITY.player, positional: false },
  [SFX.kegBlast]: { bus: "sfx", gain: 0.85, priority: PRIORITY.synergy, positional: true },
  [SFX.revenantRise]: { bus: "sfx", gain: 0.6, priority: PRIORITY.synergy, positional: true },
  [SFX.revenantShot]: { bus: "sfx", gain: 0.35, priority: PRIORITY.trap, positional: true },
  [SFX.bootWhiff]: { bus: "sfx", gain: 0.4, priority: PRIORITY.player, positional: false },
  [SFX.playerHurt]: { bus: "sfx", gain: 0.7, priority: PRIORITY.player, positional: false },
  [SFX.jawsSnap]: { bus: "sfx", gain: 0.55, priority: PRIORITY.trap, positional: true },
  [SFX.tarSquelch]: { bus: "sfx", gain: 0.3, priority: PRIORITY.ambience, positional: true },
  [SFX.ventWhoosh]: { bus: "sfx", gain: 0.4, priority: PRIORITY.trap, positional: true },
  [SFX.plateBlast]: { bus: "sfx", gain: 0.6, priority: PRIORITY.trap, positional: true },
  [SFX.sigilHum]: { bus: "sfx", gain: 0.25, priority: PRIORITY.ambience, positional: true },
  // The synergy landing outranks ordinary traps: it is information (§6).
  [SFX.ignite]: { bus: "sfx", gain: 0.7, priority: PRIORITY.synergy, positional: true },
  [SFX.clang]: { bus: "sfx", gain: 0.4, priority: PRIORITY.synergy, positional: true },
  [SFX.enemyHit]: { bus: "sfx", gain: 0.3, priority: PRIORITY.enemy, positional: true },
  [SFX.enemyDeath]: { bus: "sfx", gain: 0.4, priority: PRIORITY.enemy, positional: true },
  [SFX.windup]: { bus: "sfx", gain: 0.45, priority: PRIORITY.enemy, positional: true },
  [SFX.launched]: { bus: "sfx", gain: 0.35, priority: PRIORITY.enemy, positional: true },
  // A leak must be audible from anywhere on the map: it is the fail state.
  [SFX.leak]: { bus: "ui", gain: 0.6, priority: PRIORITY.boss, positional: false },
  [SFX.bell]: { bus: "ui", gain: 0.5, priority: PRIORITY.boss, positional: false },
  [SFX.runLost]: { bus: "ui", gain: 0.6, priority: PRIORITY.boss, positional: false },
  [SFX.roundClear]: { bus: "ui", gain: 0.45, priority: PRIORITY.ui, positional: false },
  [SFX.cardSnap]: { bus: "ui", gain: 0.35, priority: PRIORITY.ui, positional: false },
  [SFX.ledgerStamp]: { bus: "ui", gain: 0.5, priority: PRIORITY.ui, positional: false },
  [SFX.trapPlace]: { bus: "ui", gain: 0.4, priority: PRIORITY.ui, positional: false },
  [SFX.trapSell]: { bus: "ui", gain: 0.35, priority: PRIORITY.ui, positional: false },
};

/** Listener basis, written by the host each frame from the camera pose. */
export interface Listener {
  x: number;
  y: number;
  z: number;
  rightX: number;
  rightZ: number;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<"sfx" | "music" | "ui" | "ambience", GainNode> | null = null;
  private music: Music | null = null;
  private slots: VoiceSlot[] = makeSlots();
  private nextVoice = 1;
  private counter = 0;
  private jitterSeed = 0x9e37;
  private listener: Listener = { x: 0, y: 0, z: 0, rightX: 1, rightZ: 0 };
  private muted: boolean;
  /** Ticks of music ducking left, so the Bell can push the bed down. */
  private duck = 0;
  /** High-water mark of simultaneous voices, for the dev overlay and the mix. */
  private peakVoices = 0;
  private played = 0;

  constructor() {
    this.muted = localStorage.getItem(STORAGE_KEY) === "1";
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Must be called from a user gesture. Browsers refuse to start an
   * AudioContext otherwise, which is why the game demands a click before play.
   */
  resume(): void {
    if (!this.ctx) this.build();
    void this.ctx?.resume();
    this.music?.start();
  }

  private build(): void {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.9;
    // Forty bodies at once will otherwise clip the master on every wave.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const mk = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(master);
      return g;
    };
    this.buses = { sfx: mk(0.9), music: mk(0.55), ui: mk(0.8), ambience: mk(0.5) };
    this.music = new Music(ctx, this.buses.music);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem(STORAGE_KEY, this.muted ? "1" : "0");
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  setListener(l: Listener): void {
    this.listener = l;
  }

  private jitter(): number {
    let s = this.jitterSeed;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.jitterSeed = s | 0;
    return ((s >>> 0) % 2000) / 1000 - 1;
  }

  /** Play one sound. Positional sounds are panned and attenuated. */
  play(id: SfxId, x = 0, y = 0, z = 0): void {
    if (!this.ctx || !this.buses || this.muted) return;
    const spec = SPEC[id];
    if (!spec) return;

    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const dz = z - this.listener.z;
    const distance = spec.positional ? Math.sqrt(dx * dx + dy * dy + dz * dz) : 0;
    if (spec.positional && distance > CULL_DISTANCE) return;

    const now = ++this.counter;
    const slot = allocate(this.slots, {
      priority: spec.priority,
      distance,
      now,
    });
    if (slot < 0) return;

    const voiceId = this.nextVoice++;
    occupy(this.slots, slot, voiceId, { priority: spec.priority, distance, now });
    this.played++;

    const g = this.ctx.createGain();
    g.gain.value = spec.gain * (spec.positional ? gainFor(distance) : 1);

    let tail: AudioNode = g;
    if (spec.positional) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = panFor(
        dx,
        dz,
        this.listener.rightX,
        this.listener.rightZ,
        distance,
      );
      g.connect(panner);
      tail = panner;
    }
    tail.connect(this.buses[spec.bus]);

    const seconds = render(id, this.ctx, g, this.jitter());
    // Free the slot when the sound is actually over. setTimeout is fine here:
    // it is presentation, and a late free only costs one voice for a moment.
    window.setTimeout(
      () => {
        if (this.slots[slot].id === voiceId) release(this.slots, slot);
        g.disconnect();
      },
      (seconds + 0.1) * 1000,
    );
  }

  /**
   * Drain the simulation's event ring into sound.
   *
   * The mapping is exhaustive by design and covered by a test: a new event kind
   * that nobody hears is a silent regression, and silence is the hardest bug class
   * to notice.
   */
  consumeEvents(ev: EventRing): void {
    if (!this.ctx) return;
    for (let i = 0; i < ev.count; i++) {
      const x = ev.x[i];
      const y = ev.y[i];
      const z = ev.z[i];
      switch (ev.kind[i]) {
        case EV.muzzle:
          this.play(SFX.revolver);
          break;
        case EV.reloadStart:
          this.play(SFX.reloadClick);
          break;
        case EV.reloadEnd:
          this.play(SFX.reloadDone);
          break;
        case EV.abilityFired:
          this.play(SFX.abilityFire);
          break;
        case EV.fanShot:
          this.play(SFX.fanShot);
          break;
        case EV.kegThrown:
          this.play(SFX.kegThrow);
          break;
        case EV.kegBlast:
          this.play(SFX.kegBlast, x, y, z);
          break;
        case EV.revenantRose:
          this.play(SFX.revenantRise, x, y, z);
          break;
        case EV.revenantFired:
          this.play(SFX.revenantShot, x, y, z);
          break;
        /* A revenant's 15s expiry is a quiet fade, not an event — giving it a
         * sound would mean four allies each announcing themselves at once. */
        case EV.revenantFell:
          break;
        case EV.booted:
          this.play(SFX.bootThud);
          break;
        case EV.bootWhiff:
          this.play(SFX.bootWhiff);
          break;
        case EV.enemyHit:
          this.play(SFX.enemyHit, x, y, z);
          break;
        case EV.enemyKilled:
          this.play(SFX.enemyDeath, x, y, z);
          break;
        case EV.enemyWindup:
          this.play(SFX.windup, x, y, z);
          break;
        case EV.launched:
          this.play(SFX.launched, x, y, z);
          break;
        case EV.armourClang:
          this.play(SFX.clang, x, y, z);
          break;
        case EV.ignite:
          this.play(SFX.ignite, x, y, z);
          this.duckMusic();
          break;
        case EV.trapFired:
          this.play(trapSound(ev.a[i]), x, y, z);
          break;
        case EV.statusApplied:
          this.play(ev.a[i] === 4 ? SFX.sigilHum : SFX.tarSquelch, x, y, z);
          break;
        case EV.healPulse:
          // The hymn is arcane sustain, which is exactly what sigilHum already
          // says — and reusing it keeps "magic is happening here" one sound.
          this.play(SFX.sigilHum, x, y, z);
          break;
        case EV.trapPlaced:
        case EV.trapUpgraded:
          this.play(SFX.trapPlace);
          break;
        case EV.trapSold:
          this.play(SFX.trapSell);
          break;
        case EV.placeDenied:
          this.play(SFX.dryFire);
          break;
        case EV.playerHurt:
          this.play(SFX.playerHurt);
          break;
        case EV.leak:
          this.play(SFX.leak);
          this.duckMusic();
          break;
        case EV.waveStarted:
          this.play(SFX.bell);
          this.duckMusic();
          break;
        case EV.envFired:
          /*
           * Two sounds, because it is two things at once: the crash of the thing
           * coming down, and the blast under it. §4 calls these the moments a site is
           * remembered for, and a once-per-site event that shares a sound with a trap
           * is not a moment.
           */
          this.play(SFX.plateBlast, x, y, z);
          this.play(SFX.clang, x, y, z);
          this.duckMusic();
          break;
        case EV.siteEntered:
          // Arriving somewhere new is the biggest beat outside a round: the bell
          // tolls for the place, and the music gets out of the way.
          this.play(SFX.bell);
          this.duckMusic();
          break;
        case EV.roundCleared:
          this.play(SFX.roundClear);
          break;
        case EV.handScored:
          this.play(SFX.ledgerStamp);
          break;
        case EV.runLost:
        case EV.playerDied:
          this.play(SFX.runLost);
          break;
        // Deliberately silent: perfectRound is covered by roundCleared, and
        // bulletImpact would double up on every miss.
        case EV.perfectRound:
        case EV.bulletImpact:
        case EV.waveCleared:
          break;
      }
    }
  }

  /** A card flip per kill in the open hand, driven by the HUD's card count. */
  cardFlip(): void {
    this.play(SFX.cardSnap);
  }

  private duckMusic(): void {
    this.duck = 0.9;
  }

  update(dt: number, intensity: number, combat: boolean, lost: boolean): void {
    if (!this.ctx || !this.buses) return;
    this.duck = Math.max(0, this.duck - dt);
    this.buses.music.gain.setTargetAtTime(
      (this.muted ? 0 : 0.55) * (1 - this.duck * 0.55),
      this.ctx.currentTime,
      0.12,
    );
    this.music?.update(dt, intensity, combat, lost);
  }

  /** For the debug hook and the capture harness: is audio actually alive? */
  stats(): {
    state: string;
    voices: number;
    peak: number;
    played: number;
    muted: boolean;
  } {
    let voices = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].id !== -1) voices++;
    if (voices > this.peakVoices) this.peakVoices = voices;
    return {
      state: this.ctx ? this.ctx.state : "none",
      voices,
      peak: this.peakVoices,
      played: this.played,
      muted: this.muted,
    };
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Trap def id → its sound. Mirrors the TRAPS order in sim/traps.ts. */
function trapSound(defId: number): SfxId {
  switch (defId) {
    case 0:
      return SFX.jawsSnap;
    case 1:
      return SFX.tarSquelch;
    case 2:
      return SFX.ventWhoosh;
    case 3:
      return SFX.plateBlast;
    default:
      return SFX.sigilHum;
  }
}
