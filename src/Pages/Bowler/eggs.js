// Easter eggs for /bowler: typed key sequences, found-egg memory, and tiny
// WebAudio sound effects. Everything here is a per-viewer nicety, so
// storage failures (private mode, blocked storage) just mean "not found yet".
import { useCallback, useEffect, useRef, useState } from "react";

export const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
];
export const DUDE = ["d", "u", "d", "e"];

export const SECRETS = [
  { id: "dude", icon: "fa-martini-glass", label: "The Dude Abides", desc: "Typed the magic word" },
  { id: "konami", icon: "fa-gamepad", label: "Cosmic Bowler", desc: "Up up down down..." },
  { id: "sign", icon: "fa-bolt", label: "Tilt!", desc: "Broke the neon sign" },
];

const STORE_KEY = "bw-secrets";
const SOUND_KEY = "bw-sound";

const read = (key, fallback) => {
  try {
    const v = window.localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the egg still works, it just isn't remembered */
  }
};

const isTyping = (el) =>
  el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

/** Fire `onMatch` when the keys in `sequence` are pressed in order. */
export function useKeySequence(sequence, onMatch) {
  const pos = useRef(0);
  const cb = useRef(onMatch);
  cb.current = onMatch;

  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e.target)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === sequence[pos.current]) {
        pos.current += 1;
        if (pos.current === sequence.length) {
          pos.current = 0;
          cb.current();
        }
      } else {
        pos.current = key === sequence[0] ? 1 : 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sequence]);
}

/** Found secrets, persisted per browser. */
export function useSecrets() {
  const [found, setFound] = useState(() => read(STORE_KEY, []));
  const discover = useCallback((id) => {
    setFound((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      write(STORE_KEY, next);
      return next;
    });
  }, []);
  return { found, discover };
}

export function useSoundSetting() {
  const [on, setOn] = useState(() => read(SOUND_KEY, false));
  const toggle = useCallback(() => {
    setOn((prev) => {
      write(SOUND_KEY, !prev);
      return !prev;
    });
  }, []);
  return [on, toggle];
}

// ---- sound effects (synthesized, no audio files) ----

let ctx;
const audio = () => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
};

function tone(ac, { freq, to, start, dur, type = "sawtooth", gain = 0.12 }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

function crash(ac, start) {
  // A burst of filtered noise: pins going everywhere.
  const len = Math.floor(ac.sampleRate * 0.6);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ac.createBufferSource();
  const filter = ac.createBiquadFilter();
  const g = ac.createGain();
  src.buffer = buf;
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  g.gain.value = 0.5;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(start);
}

export function playSound(kind) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  if (kind === "gutter") {
    // wah wah wah waaah
    [392, 370, 349].forEach((f, i) => tone(ac, { freq: f, start: t + i * 0.32, dur: 0.28, gain: 0.1 }));
    tone(ac, { freq: 330, to: 300, start: t + 0.96, dur: 0.9, gain: 0.1 });
    return;
  }
  // rolling rumble, then the crash
  tone(ac, { freq: 70, to: 50, start: t, dur: 0.55, type: "triangle", gain: 0.25 });
  crash(ac, t + 0.52);
  if (kind === "club" || kind === "perfect") {
    const notes = kind === "perfect" ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
    notes.forEach((f, i) =>
      tone(ac, { freq: f, start: t + 0.9 + i * 0.12, dur: 0.3, type: "square", gain: 0.06 })
    );
  }
}
