/*
 * Game-show bleeps synthesised with WebAudio (no audio files). Every call is
 * a silent no-op when AudioContext is unavailable (jsdom, old browsers) or
 * when muted. The host and the phones share this module.
 */

const MUTE_KEY = "jeopardrink-muted";
let ctx = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

const audio = () => {
  if (muted || typeof window === "undefined") return null;
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

function tone(ac, { freq, to, start, dur, type = "sine", gain = 0.12 }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

const notes = (ac, t, freqs, { step = 0.09, dur = 0.22, type = "triangle", gain = 0.12 } = {}) =>
  freqs.forEach((freq, i) => tone(ac, { freq, start: t + i * step, dur, type, gain }));

const SOUNDS = {
  // someone rang in — the classic two-tone "you're up"
  ringIn: (ac, t) => notes(ac, t, [988, 1319], { step: 0.11, dur: 0.18, type: "sine", gain: 0.16 }),
  right: (ac, t) => notes(ac, t, [523, 659, 784, 1047], { step: 0.07 }),
  wrong: (ac, t) => {
    tone(ac, { freq: 140, start: t, dur: 0.5, type: "square", gain: 0.07 });
    tone(ac, { freq: 147, start: t, dur: 0.5, type: "sawtooth", gain: 0.04 });
  },
  dailyDouble: (ac, t) => {
    tone(ac, { freq: 220, to: 1760, start: t, dur: 0.55, type: "sawtooth", gain: 0.06 });
    notes(ac, t + 0.5, [880, 1109, 1319, 1760], { step: 0.06, dur: 0.3 });
  },
  timesUp: (ac, t) => notes(ac, t, [392, 330, 262], { step: 0.16, dur: 0.3, type: "square", gain: 0.05 }),
  tick: (ac, t) => tone(ac, { freq: 1400, start: t, dur: 0.05, type: "square", gain: 0.03 }),
  // the phone's own buzzer press
  buzz: (ac, t) => tone(ac, { freq: 620, to: 420, start: t, dur: 0.16, type: "square", gain: 0.08 }),
  cheers: (ac, t) => notes(ac, t, [523, 659, 784, 1047, 1319, 1568], { step: 0.08, dur: 0.35 }),
};

export function play(name) {
  const ac = audio();
  const sound = SOUNDS[name];
  if (!ac || !sound) return;
  try {
    sound(ac, ac.currentTime + 0.01);
  } catch {
    /* a sound is never worth an error */
  }
}

export const isMuted = () => muted;

export function setMuted(next) {
  muted = Boolean(next);
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode: the setting just won't stick */
  }
}
