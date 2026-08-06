/*
 * audio/synth.ts — every sound in the game, generated from oscillators and noise.
 *
 * No samples. Not because samples are wrong — §16.4 plans a generated library —
 * but because a synthesised placeholder set costs nothing, ships today, and makes
 * the game audible *now*, which is what tells you whether the mix and the mapping
 * are right. Real one-shots drop in behind the same `play()` signature later.
 *
 * Each sound is built the way a sound designer would layer it (§16.4): a
 * transient, a body, and a tail. A revolver is a noise crack over a low thump
 * over a room tail — not one oscillator with a name.
 *
 * Everything is deterministic apart from the small jitter, which is cosmetic and
 * uses its own generator: audio never touches the sim's RNG streams (§13 rule 2).
 */

export const SFX = {
  revolver: 0,
  dryFire: 1,
  reloadClick: 2,
  reloadDone: 3,
  bootThud: 4,
  bootWhiff: 5,
  jawsSnap: 6,
  tarSquelch: 7,
  ventWhoosh: 8,
  ignite: 9,
  plateBlast: 10,
  sigilHum: 11,
  clang: 12,
  enemyHit: 13,
  enemyDeath: 14,
  leak: 15,
  bell: 16,
  cardSnap: 17,
  ledgerStamp: 18,
  playerHurt: 19,
  roundClear: 20,
  trapPlace: 21,
  trapSell: 22,
  launched: 23,
  windup: 24,
  runLost: 25,
} as const;

export type SfxId = (typeof SFX)[keyof typeof SFX];

let noiseBuffer: AudioBuffer | null = null;

/** One second of white noise, reused by every noise-based layer. */
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // A tiny xorshift so the noise is identical every session — makes A/B mixing
  // comparisons meaningful.
  let s = 0x2f6bff;
  for (let i = 0; i < len; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    d[i] = ((s >>> 0) / 2147483648 - 1) * 0.999;
  }
  noiseBuffer = buf;
  return buf;
}

interface Ctx {
  ctx: AudioContext;
  out: AudioNode;
  t: number;
  /** Cosmetic pitch/level jitter in [-1, 1]. */
  j: number;
}

// ── building blocks ────────────────────────────────────────────────────────

function env(
  ctx: AudioContext,
  t: number,
  peak: number,
  attack: number,
  decay: number,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function noiseBurst(
  c: Ctx,
  peak: number,
  attack: number,
  decay: number,
  type: BiquadFilterType,
  from: number,
  to: number,
  q = 1,
): void {
  const src = c.ctx.createBufferSource();
  src.buffer = noise(c.ctx);
  src.loop = true;
  // Start at a varying offset so repeated shots never sound like a loop point.
  const filter = c.ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, c.t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), c.t + attack + decay);
  const g = env(c.ctx, c.t, peak, attack, decay);
  src.connect(filter).connect(g).connect(c.out);
  src.start(c.t, Math.abs(c.j) * 0.5);
  src.stop(c.t + attack + decay + 0.02);
}

function tone(
  c: Ctx,
  type: OscillatorType,
  from: number,
  to: number,
  peak: number,
  attack: number,
  decay: number,
  detune = 0,
): void {
  const o = c.ctx.createOscillator();
  o.type = type;
  o.detune.value = detune + c.j * 12;
  o.frequency.setValueAtTime(from, c.t);
  if (to !== from) {
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), c.t + attack + decay);
  }
  const g = env(c.ctx, c.t, peak, attack, decay);
  o.connect(g).connect(c.out);
  o.start(c.t);
  o.stop(c.t + attack + decay + 0.02);
}

/**
 * Inharmonic partials, which is what makes struck metal sound like metal rather
 * than like a flute. The ratios are the classic bell series.
 */
const BELL_PARTIALS = [1, 2.76, 5.4, 8.93];

function metal(c: Ctx, root: number, peak: number, decay: number): void {
  for (let i = 0; i < BELL_PARTIALS.length; i++) {
    tone(
      c,
      "sine",
      root * BELL_PARTIALS[i],
      root * BELL_PARTIALS[i],
      peak / (i + 1.6),
      0.002,
      decay * (1 - i * 0.16),
    );
  }
}

// ── the library ────────────────────────────────────────────────────────────

/**
 * Render one sound into `out`. Returns roughly how long it will last, so the
 * voice pool knows when to free the slot.
 */
export function render(id: SfxId, ctx: AudioContext, out: AudioNode, jitter: number): number {
  const c: Ctx = { ctx, out, t: ctx.currentTime, j: jitter };

  switch (id) {
    case SFX.revolver:
      // Transient crack, low thump, room tail. A single-action revolver is a
      // *snap* with weight under it, not an explosion.
      noiseBurst(c, 0.9, 0.001, 0.09, "bandpass", 3200, 900, 0.8);
      tone(c, "sine", 150, 55, 0.55, 0.002, 0.16);
      noiseBurst(c, 0.16, 0.01, 0.42, "lowpass", 1400, 320);
      return 0.5;

    case SFX.dryFire:
      metal(c, 1500, 0.12, 0.05);
      return 0.1;

    case SFX.reloadClick:
      // The cylinder ratchet: one dry mechanical tick.
      metal(c, 2100, 0.13, 0.04);
      noiseBurst(c, 0.1, 0.001, 0.03, "highpass", 2600, 2600);
      return 0.08;

    case SFX.reloadDone:
      metal(c, 900, 0.2, 0.16);
      return 0.2;

    case SFX.bootThud:
      // Body impact: all low end, almost no top.
      tone(c, "sine", 120, 42, 0.85, 0.004, 0.2);
      noiseBurst(c, 0.35, 0.002, 0.1, "lowpass", 700, 180);
      return 0.28;

    case SFX.bootWhiff:
      noiseBurst(c, 0.16, 0.02, 0.16, "bandpass", 1100, 380, 1.4);
      return 0.2;

    case SFX.jawsSnap:
      // Two iron plates meeting, hard.
      metal(c, 780, 0.5, 0.12);
      metal(c, 1240, 0.3, 0.07);
      noiseBurst(c, 0.4, 0.001, 0.05, "highpass", 3000, 1600);
      tone(c, "sine", 90, 60, 0.3, 0.003, 0.1);
      return 0.22;

    case SFX.tarSquelch:
      noiseBurst(c, 0.24, 0.05, 0.3, "lowpass", 520, 160, 0.7);
      tone(c, "sine", 70, 48, 0.18, 0.04, 0.26);
      return 0.4;

    case SFX.ventWhoosh:
      // Gas igniting: a rising hiss with a body under it.
      noiseBurst(c, 0.5, 0.02, 0.34, "bandpass", 380, 1900, 0.9);
      tone(c, "sawtooth", 90, 150, 0.16, 0.03, 0.3);
      return 0.42;

    case SFX.ignite:
      // The headline synergy gets the biggest sound in the game: a whoomph.
      noiseBurst(c, 0.85, 0.015, 0.62, "lowpass", 900, 3200, 0.6);
      tone(c, "sawtooth", 180, 46, 0.4, 0.01, 0.5);
      tone(c, "sine", 60, 38, 0.5, 0.02, 0.7);
      return 0.8;

    case SFX.plateBlast:
      noiseBurst(c, 0.9, 0.001, 0.3, "lowpass", 2400, 300);
      tone(c, "sine", 110, 34, 0.8, 0.003, 0.42);
      return 0.5;

    case SFX.sigilHum:
      // Arcane, so it must not sound like anything else: a clean detuned pair.
      tone(c, "triangle", 320, 320, 0.1, 0.08, 0.5);
      tone(c, "triangle", 322.5, 322.5, 0.1, 0.08, 0.5, 8);
      return 0.6;

    case SFX.clang:
      // Deliberately bright and *unsatisfying*: the point is that it did nothing.
      metal(c, 1650, 0.42, 0.3);
      noiseBurst(c, 0.2, 0.001, 0.04, "highpass", 4200, 3000);
      return 0.34;

    case SFX.enemyHit:
      noiseBurst(c, 0.3, 0.002, 0.08, "lowpass", 1100, 260);
      return 0.12;

    case SFX.enemyDeath:
      // A body coming apart, plus a short breath out.
      noiseBurst(c, 0.4, 0.004, 0.26, "lowpass", 900, 180);
      tone(c, "sawtooth", 150, 44, 0.22, 0.01, 0.3);
      return 0.36;

    case SFX.leak:
      // Something got through. It should feel like loss, and be audible anywhere
      // on the map — this is information the player must not miss.
      tone(c, "sine", 420, 130, 0.4, 0.06, 0.9);
      tone(c, "sine", 421, 128, 0.3, 0.08, 1.0, -14);
      noiseBurst(c, 0.14, 0.1, 0.8, "bandpass", 700, 260, 2);
      return 1.1;

    case SFX.bell:
      // The Ninth Bell. Long, inharmonic, unhurried.
      metal(c, 196, 0.55, 2.6);
      metal(c, 293, 0.22, 1.9);
      return 2.8;

    case SFX.cardSnap:
      noiseBurst(c, 0.22, 0.001, 0.035, "bandpass", 4200, 2200, 1.6);
      return 0.06;

    case SFX.ledgerStamp:
      // Paper, then wood. The ledger closing on a scored hand.
      noiseBurst(c, 0.35, 0.001, 0.05, "bandpass", 1500, 600, 1.1);
      tone(c, "sine", 130, 70, 0.32, 0.002, 0.12);
      return 0.2;

    case SFX.playerHurt:
      tone(c, "sawtooth", 220, 70, 0.4, 0.005, 0.28);
      noiseBurst(c, 0.3, 0.002, 0.2, "lowpass", 800, 200);
      return 0.34;

    case SFX.roundClear:
      // A small, dry, unearned-sounding fanfare: a fifth and an octave on organ.
      tone(c, "triangle", 196, 196, 0.2, 0.02, 0.7);
      tone(c, "triangle", 294, 294, 0.16, 0.06, 0.7);
      tone(c, "triangle", 392, 392, 0.13, 0.12, 0.7);
      return 0.9;

    case SFX.trapPlace:
      metal(c, 620, 0.22, 0.09);
      noiseBurst(c, 0.16, 0.002, 0.07, "lowpass", 900, 300);
      return 0.16;

    case SFX.trapSell:
      metal(c, 880, 0.16, 0.12);
      return 0.16;

    case SFX.launched:
      noiseBurst(c, 0.28, 0.01, 0.24, "bandpass", 500, 1500, 1.1);
      return 0.3;

    case SFX.windup:
      // The telegraph. Short, dry, and *above* the mix so it can be reacted to.
      tone(c, "square", 300, 210, 0.1, 0.01, 0.1);
      return 0.14;

    case SFX.runLost:
      metal(c, 147, 0.6, 3.4);
      tone(c, "sine", 90, 42, 0.35, 0.2, 2.4);
      return 3.6;

    default:
      return 0;
  }
}
