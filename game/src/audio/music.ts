/*
 * audio/music.ts — the layered bed from §16.
 *
 * Music as *stems crossfaded by intensity*, not as tracks that start and stop.
 * The build phase is a drone; combat adds a pulse; a lane full of bodies adds the
 * choir. That is the shape the real generated stems will slot into (§16.4) — this
 * synthesises them so the architecture is exercised and the game has a mood today.
 *
 * Everything is one continuously-running graph with gains that move. Starting and
 * stopping oscillators per round would click, and would make the intensity
 * crossfade impossible.
 */

/** D dorian for Act I, per the §16.4 key/tempo table. */
const ROOT = 73.42; // D2
const FIFTH = ROOT * 1.5;
const MINOR_THIRD = ROOT * 1.2;

export interface MusicLayers {
  /** Harmonium drone. Always audible. */
  bed: GainNode;
  /** A slow heartbeat during combat. */
  pulse: GainNode;
  /** Choir cluster, fades in with pressure. */
  danger: GainNode;
}

export class Music {
  private ctx: AudioContext;
  private layers: MusicLayers;
  private pulseTimer = 0;
  private pulseOut: AudioNode;
  private started = false;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;

    const bed = ctx.createGain();
    const pulse = ctx.createGain();
    const danger = ctx.createGain();
    bed.gain.value = 0;
    pulse.gain.value = 0;
    danger.gain.value = 0;
    bed.connect(out);
    pulse.connect(out);
    danger.connect(out);
    this.layers = { bed, pulse, danger };
    this.pulseOut = pulse;
  }

  /** Must be called from a user gesture, like the AudioContext itself. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const { ctx } = this;
    const t = ctx.currentTime;

    // ── bed: a pumped-organ drone. Two detuned saws under a moving lowpass is
    // the cheapest convincing harmonium, and the slow filter sweep is what stops
    // a held drone from becoming wallpaper.
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 340;
    lp.Q.value = 3;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 130;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start(t);

    for (const [freq, detune, level] of [
      [ROOT, -6, 0.5],
      [ROOT, 7, 0.5],
      [ROOT * 2, 3, 0.16],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(lp);
      o.start(t);
    }
    lp.connect(this.layers.bed);

    // ── danger: a minor cluster with slow tremolo. Choir-adjacent, and the minor
    // third is doing all the emotional work.
    const dangerFilter = ctx.createBiquadFilter();
    dangerFilter.type = "lowpass";
    dangerFilter.frequency.value = 900;
    const trem = ctx.createOscillator();
    const tremGain = ctx.createGain();
    trem.frequency.value = 4.6;
    tremGain.gain.value = 0.35;
    const tremTarget = ctx.createGain();
    tremTarget.gain.value = 0.65;
    trem.connect(tremGain).connect(tremTarget.gain);
    trem.start(t);

    for (const [freq, detune] of [
      [MINOR_THIRD, 0],
      [FIFTH, -5],
      [ROOT * 2, 4],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.22;
      o.connect(g).connect(tremTarget);
      o.start(t);
    }
    tremTarget.connect(dangerFilter).connect(this.layers.danger);
  }

  /**
   * @param intensity 0..1 — how much pressure the player is under.
   * @param combat    true while bodies are on the ground.
   */
  update(dt: number, intensity: number, combat: boolean, lost: boolean): void {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const ramp = (g: GainNode, v: number, time = 0.7) => {
      g.gain.setTargetAtTime(v, t, time);
    };

    if (lost) {
      // §9 phase 3's idea, applied to failure: everything drops away.
      ramp(this.layers.bed, 0.05, 1.4);
      ramp(this.layers.pulse, 0, 0.6);
      ramp(this.layers.danger, 0, 1.4);
      return;
    }

    ramp(this.layers.bed, 0.16);
    ramp(this.layers.pulse, combat ? 0.5 : 0, 0.5);
    ramp(this.layers.danger, combat ? intensity * 0.5 : 0, 1.1);

    // 84 BPM from the §16.4 Act I row. The pulse quickens with pressure, which is
    // the cheapest way to make a fight feel like it is getting away from you.
    if (!combat) return;
    const beat = 60 / (84 + intensity * 26);
    this.pulseTimer -= dt;
    if (this.pulseTimer <= 0) {
      this.pulseTimer = beat;
      this.thump(intensity);
    }
  }

  /** A boot on a boardwalk. Dry, low, no tail. */
  private thump(intensity: number): void {
    const { ctx } = this;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 + intensity * 0.3, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g).connect(this.pulseOut);
    o.start(t);
    o.stop(t + 0.22);
  }
}
