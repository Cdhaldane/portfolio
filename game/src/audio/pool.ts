/*
 * audio/pool.ts — voice allocation, as pure logic.
 *
 * Separated from the Web Audio graph on purpose: with forty bodies on screen a
 * horde game will ask for far more sounds than it can afford to play, so *which
 * request wins* is a real decision with real rules — and rules deserve tests.
 * Nothing in this file touches AudioContext, so `tests/audio.test.ts` runs it in
 * plain Node (§19.1).
 *
 * §16: a pool of 32 with priority stealing and distance culling. Without it,
 * forty simultaneous enemy footsteps will crush a mid-range laptop.
 */

export const PRIORITY = {
  /** Never stolen: the player must always hear their own gun and their own pain. */
  player: 100,
  boss: 80,
  /** The synergy landing is information, not decoration. */
  synergy: 70,
  trap: 60,
  ui: 55,
  enemy: 30,
  ambience: 10,
} as const;

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

export interface VoiceSlot {
  /** -1 when free. */
  id: number;
  priority: number;
  /** Tick (or monotonic counter) the voice started, for oldest-first eviction. */
  startedAt: number;
  /** Distance from the listener when it started, for culling comparisons. */
  distance: number;
}

export interface AllocRequest {
  priority: number;
  distance: number;
  now: number;
}

export const MAX_VOICES = 32;
/** Beyond this, a positional sound is not worth a voice at all. */
export const CULL_DISTANCE = 44;

export function makeSlots(count = MAX_VOICES): VoiceSlot[] {
  const slots: VoiceSlot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({ id: -1, priority: 0, startedAt: 0, distance: 0 });
  }
  return slots;
}

/**
 * Pick a slot for a new sound, or -1 to drop it.
 *
 * Order of preference:
 *   1. a free slot;
 *   2. steal the *lowest priority* voice, if the newcomer outranks it;
 *   3. at equal priority, steal the furthest away — a distant duplicate is the
 *      one nobody will miss;
 *   4. at equal priority and distance, steal the oldest.
 */
export function allocate(slots: VoiceSlot[], req: AllocRequest): number {
  if (req.distance > CULL_DISTANCE && req.priority < PRIORITY.player) return -1;

  for (let i = 0; i < slots.length; i++) {
    if (slots[i].id === -1) return i;
  }

  let victim = -1;
  let worstPriority = Infinity;
  let worstDistance = -Infinity;
  let worstStart = Infinity;

  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s.priority < worstPriority) {
      victim = i;
      worstPriority = s.priority;
      worstDistance = s.distance;
      worstStart = s.startedAt;
      continue;
    }
    if (s.priority !== worstPriority) continue;
    if (s.distance > worstDistance) {
      victim = i;
      worstDistance = s.distance;
      worstStart = s.startedAt;
      continue;
    }
    if (s.distance === worstDistance && s.startedAt < worstStart) {
      victim = i;
      worstStart = s.startedAt;
    }
  }

  // A quiet, distant enemy grunt must never silence the player's revolver, and
  // equally must not evict something more important than itself.
  if (victim >= 0 && req.priority < slots[victim].priority) return -1;
  return victim;
}

export function occupy(
  slots: VoiceSlot[],
  index: number,
  id: number,
  req: AllocRequest,
): void {
  const s = slots[index];
  s.id = id;
  s.priority = req.priority;
  s.startedAt = req.now;
  s.distance = req.distance;
}

export function release(slots: VoiceSlot[], index: number): void {
  const s = slots[index];
  s.id = -1;
  s.priority = 0;
  s.startedAt = 0;
  s.distance = 0;
}

/**
 * Stereo pan and gain for a source, from the listener's basis vectors.
 *
 * A `PannerNode` per voice is the textbook answer and the wrong one here: 32 of
 * them with HRTF is a measurable cost for a top-down-ish camera that barely needs
 * elevation cues. A dot product against the camera's right vector gives a
 * convincing pan for a tenth of the price.
 */
export function panFor(
  dx: number,
  dz: number,
  rightX: number,
  rightZ: number,
  distance: number,
): number {
  if (distance < 0.001) return 0;
  const pan = (dx * rightX + dz * rightZ) / distance;
  // Never hard-pan: fully one-sided audio is disorienting on headphones.
  return Math.max(-0.85, Math.min(0.85, pan));
}

/** Inverse-ish falloff, flat inside `full` and silent past CULL_DISTANCE. */
export function gainFor(distance: number, full = 6): number {
  if (distance <= full) return 1;
  if (distance >= CULL_DISTANCE) return 0;
  const t = (distance - full) / (CULL_DISTANCE - full);
  return (1 - t) * (1 - t);
}
