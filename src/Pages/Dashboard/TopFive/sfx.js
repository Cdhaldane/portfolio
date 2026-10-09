/*
 * Opt-in sound effects, synthesised with WebAudio (no audio files). Off by
 * default; every call is a silent no-op when AudioContext is unavailable
 * (jsdom, very old browsers) or when the context can't start.
 */

let ctx = null;

const audio = () => {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch {
    return null;
  }
};

function tone(ac, { freq, to, start, dur, type = "sine", gain = 0.1 }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

// Deterministic noise (no Math.random) so the crinkle sounds the same each time.
function noise(ac, { start, dur, from, to, gain = 0.3, q = 1.2 }) {
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 1234567;
  for (let i = 0; i < len; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const crackle = 0.55 + 0.45 * Math.sin((i / ac.sampleRate) * 2 * Math.PI * 40);
    data[i] = ((seed / 2147483647) * 2 - 1) * crackle * (1 - i / len);
  }
  const src = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = buf;
  filter.type = "bandpass";
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + dur);
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(start);
}

const TIER_CHIMES = {
  common: [659],
  uncommon: [659, 831],
  rare: [659, 831, 988],
  ultra: [659, 831, 988, 1319],
};

const SOUNDS = {
  rip: (ac, t) => noise(ac, { start: t, dur: 0.42, from: 900, to: 4200, gain: 0.35 }),
  swish: (ac, t) => noise(ac, { start: t, dur: 0.16, from: 2400, to: 700, gain: 0.12, q: 0.8 }),
  tick: (ac, t) => tone(ac, { freq: 1800, start: t, dur: 0.05, type: "square", gain: 0.03 }),
  thud: (ac, t) => tone(ac, { freq: 120, to: 48, start: t, dur: 0.32, type: "triangle", gain: 0.3 }),
  legend: (ac, t) => {
    tone(ac, { freq: 90, to: 40, start: t, dur: 0.6, type: "triangle", gain: 0.32 });
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(ac, { freq: f, start: t + 0.12 + i * 0.09, dur: 0.34, type: "square", gain: 0.05 })
    );
  },
  fanfare: (ac, t) => {
    [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) =>
      tone(ac, { freq: f, start: t + i * 0.11, dur: 0.22, type: "sawtooth", gain: 0.05 })
    );
  },
  horn: (ac, t) => {
    tone(ac, { freq: 311, start: t, dur: 0.22, type: "square", gain: 0.06 });
    tone(ac, { freq: 311, start: t + 0.3, dur: 0.22, type: "square", gain: 0.06 });
  },
};

/** Play a named effect. `kind` is a key of SOUNDS or "chime:<tier>". */
export function playSfx(kind) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  if (kind.startsWith("chime:")) {
    const notes = TIER_CHIMES[kind.slice(6)] || TIER_CHIMES.common;
    notes.forEach((f, i) => tone(ac, { freq: f, start: t + i * 0.07, dur: 0.3, type: "triangle", gain: 0.06 }));
    return;
  }
  const play = SOUNDS[kind];
  if (play) play(ac, t);
}
