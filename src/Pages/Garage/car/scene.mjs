import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShadowMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SHELL, buildCar } from "./model.mjs";
import { MODS, MOD_BY_ID, OVERVIEW, cameraFrom } from "./mods.mjs";

/*
 * The Build tab's showroom: the code-built Golf R on a studio floor, an orbit
 * rig that eases between views, and the three reveals a mod can ask for (lift
 * the hood, x-ray the body, clear the glass). Owns its canvas and render loop;
 * React only calls select / hover / setSpin and listens for picks.
 *
 * Renders on demand: while nothing moves, no frames are drawn. Pauses when the
 * canvas scrolls out of view or the tab is hidden. Under reduced motion there
 * is no turntable or pulse, and views cut instead of fly.
 */

const ACCENT = new Color("#ff5d3b");
const SHEEN = new Color("#ffffff");
const EASE_RATE = 4.2; // per second, for the camera's exponential approach
const REVEAL_RATE = 3.2;
const SPIN_DEG_S = 7;

/* --------------------------------------------------------------- textures -- */

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function texture(draw, size = 512) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** 2x2 twill: tows alternate direction in a diagonal staircase, each with a sheen across it. */
const twill = () =>
  texture((g, size) => {
    const n = 8;
    const s = size / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const warp = (i + j) % 4 < 2;
        const x = i * s;
        const y = j * s;
        const grad = warp ? g.createLinearGradient(x, 0, x + s, 0) : g.createLinearGradient(0, y, 0, y + s);
        const mid = warp ? "#45494f" : "#2b2e33";
        grad.addColorStop(0, "#0a0b0c");
        grad.addColorStop(0.5, mid);
        grad.addColorStop(1, "#0a0b0c");
        g.fillStyle = grad;
        g.fillRect(x, y, s, s);
      }
    }
  });

/** Draw a shape at a tile's wrap positions too, so the texture tiles seamlessly. */
function wrapped(g, size, cx, cy, draw) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      g.save();
      g.translate(cx + ox, cy + oy);
      draw();
      g.restore();
    }
  }
}

/*
 * Forged carbon: chopped fibre, random angular flakes in greys on near-black.
 * `flake` scatters the hood's sky blue chips through it.
 */
const forged = (flake = false) =>
  texture((g, size) => {
    const r = rng(7);
    g.fillStyle = "#0c0c0d";
    g.fillRect(0, 0, size, size);
    for (let k = 0; k < 1500; k++) {
      const cx = r() * size;
      const cy = r() * size;
      const len = 8 + r() * 46;
      const wid = 3 + r() * 14;
      const a = r() * Math.PI;
      const v = Math.floor(18 + r() ** 1.6 * 80);
      const j = [r(), r(), r(), r()];
      g.fillStyle = `rgb(${v},${v},${v + 3})`;
      g.globalAlpha = 0.55 + r() * 0.45;
      wrapped(g, size, cx, cy, () => {
        g.rotate(a);
        g.beginPath();
        g.moveTo(-len / 2, -wid / 2);
        g.lineTo(len / 2, -wid * (0.2 + j[0] * 0.3));
        g.lineTo(len / 2 - j[1] * 6, wid / 2);
        g.lineTo(-len / 2 + j[2] * 6, wid * (0.2 + j[3] * 0.3));
        g.closePath();
        g.fill();
      });
    }
    g.globalAlpha = 1;
    if (!flake) return;
    const s = rng(11);
    for (let k = 0; k < 9; k++) {
      const cx = s() * size;
      const cy = s() * size;
      const rad = 10 + s() * 18;
      const n = 7 + Math.floor(s() * 4);
      const pts = Array.from({ length: n }, (_, i) => {
        const t = (i / n) * Math.PI * 2;
        const rr = rad * (0.45 + s() * 0.75);
        return [Math.cos(t) * rr, Math.sin(t) * rr * (0.5 + s() * 0.6)];
      });
      g.fillStyle = s() < 0.5 ? "#3cc4e0" : "#52d0ea";
      wrapped(g, size, cx, cy, () => {
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.fill();
      });
    }
  });

/* --------------------------------------------------------------- stickers -- */

const FONTS = {
  display: "'Arial Black', 'Segoe UI Black', Impact, sans-serif",
  sans: "'Segoe UI', Arial, Helvetica, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  script: "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive",
};

/** Paint a sticker's text layout (model.mjs STICKER) onto a canvas. */
function stickerTexture(spec, aniso) {
  const { w, h } = spec;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (spec.bg) {
    g.fillStyle = spec.bg;
    g.fillRect(0, 0, w, h);
  }
  for (const b of spec.bands || []) {
    g.fillStyle = b.color;
    g.fillRect(0, b.y0 * h, w, (b.y1 - b.y0) * h);
  }
  if (spec.border) {
    g.strokeStyle = spec.border;
    g.lineWidth = h * 0.035;
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  }
  for (const r of spec.rects || []) {
    g.fillStyle = r.color || "#ffffff";
    g.fillRect(r.x * w, r.y * h, r.w * w, r.h * h);
  }
  for (const l of spec.lines || []) {
    g.fillStyle = l.color || "#ffffff";
    g.font = `${l.style || "900"} ${Math.round(l.size * h)}px ${FONTS[l.font || "display"]}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const max = (l.max ?? 0.92) * w;
    const tw = g.measureText(l.text).width;
    g.save();
    g.translate((l.x ?? 0.5) * w, l.y * h);
    if (tw > max) g.scale(max / tw, 1);
    g.fillText(l.text, 0, 0);
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** Soft contact shadow under the car. */
const blob = () => {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0.62)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.3)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
};

/* -------------------------------------------------------------- materials -- */

function materials(renderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tw = twill();
  const fg = forged();
  const ff = forged(true);
  for (const t of [tw, fg, ff]) t.anisotropy = aniso;
  const std = (color, roughness, metalness = 0, extra = {}) =>
    new MeshStandardMaterial({ color, roughness, metalness, side: DoubleSide, ...extra });
  const phys = (color, roughness, extra = {}) =>
    new MeshPhysicalMaterial({ color, roughness, metalness: 0, side: DoubleSide, ...extra });
  return {
    // Avery gloss wrap, sky blue leaning turquoise: no flake, a deep clear top layer.
    paint: phys("#3cc2de", 0.24, { clearcoat: 1, clearcoatRoughness: 0.03 }),
    under: std("#0c0d0f", 0.9),
    trim: std("#0b0b0c", 0.55),
    gloss: phys("#060607", 0.18, { clearcoat: 1, clearcoatRoughness: 0.05 }),
    glass: phys("#0d1317", 0.03, { transparent: true, opacity: 0.55, depthWrite: false, envMapIntensity: 1.6 }),
    tint: phys("#05080a", 0.03, { transparent: true, opacity: 0.84, depthWrite: false, envMapIntensity: 1.6 }),
    visor: phys("#0a0c0e", 0.12, { transparent: true, opacity: 0.88, clearcoat: 1 }),
    lens: phys("#ffffff", 0.02, { transparent: true, opacity: 0.16, depthWrite: false }),
    lamp: std("#15171a", 0.25, 0.7),
    chrome: std("#ffffff", 0.06, 1),
    steel: std("#c5c9ce", 0.26, 1),
    tip: std("#141518", 0.22, 0.9),
    machined: std("#e4e7ea", 0.3, 0.9),
    lug: std("#c9a14a", 0.3, 1),
    sensor: std("#5b646b", 0.4, 0.2),
    cover: std("#141517", 0.55, 0, { transparent: true }),
    reservoir: std("#e9e7df", 0.5, 0, { transparent: true, opacity: 0.92 }),
    blue: std("#2a6fe0", 0.4),
    inlet: std("#1a1b1e", 0.35, 0.3),
    tire: std("#131313", 0.88),
    wheel: phys("#070708", 0.2, { clearcoat: 0.8, clearcoatRoughness: 0.08 }),
    disc: std("#8b8d91", 0.45, 0.9),
    caliper: std("#141518", 0.5, 0.2),
    carbon: phys("#ffffff", 0.38, { map: tw, clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0.2 }),
    forged: phys("#ffffff", 0.34, { map: fg, clearcoat: 1, clearcoatRoughness: 0.04, metalness: 0.15 }),
    forgedFlake: phys("#ffffff", 0.32, { map: ff, clearcoat: 1, clearcoatRoughness: 0.03, metalness: 0.15 }),
    tail: phys("#7d0b10", 0.12, { emissive: "#ff1f1f", emissiveIntensity: 0.18, clearcoat: 1 }),
    tailLed: std("#ff3b30", 0.4, 0, { emissive: "#ff3b30", emissiveIntensity: 2 }),
    drl: std("#ffffff", 0.3, 0, { emissive: "#eaf4ff", emissiveIntensity: 1.8 }),
    amber: std("#ff9a1a", 0.3, 0, { emissive: "#ff8a00", emissiveIntensity: 0.4 }),
    engine: std("#5b5f65", 0.45, 0.55),
    plastic: std("#17181a", 0.7),
    red: std("#d0141f", 0.35),
    ecu: std("#3a3f47", 0.4, 0.6),
    interior: std("#1a1b1e", 0.95),
    leather: std("#131416", 0.6),
    mirror: std("#a3adb6", 0.04, 1),
  };
}

/* ------------------------------------------------------------------ scene -- */

/**
 * Mount the showroom on a canvas. Throws if WebGL isn't available.
 * onPick(modId) fires when a part is clicked, onHover(modId | null) as the
 * pointer moves over parts.
 */
export function createShowroom(canvas, { onPick, onHover, reducedMotion = false } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.03).texture;
  room.dispose?.();

  const camera = new PerspectiveCamera(30, 1, 0.05, 60);

  const key = new DirectionalLight("#ffffff", 1.6);
  key.position.set(2.5, 7, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -3.2;
  key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -3.2;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 14;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key);

  // Floor: a shadow catcher and a soft contact shadow, both see-through.
  const floor = new Mesh(new CircleGeometry(9, 64), new ShadowMaterial({ opacity: 0.22 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const contact = new Mesh(
    new CircleGeometry(1, 48),
    new MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false, opacity: 0.9 }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.scale.set(2.6, 1.25, 1);
  contact.position.y = 0.002;
  scene.add(contact);

  // The car, with one material per (key, part) so a part can glow alone.
  const car = buildCar();
  const base = materials(renderer);
  const byPart = new Map();
  const clones = new Map();
  const shells = new Set();
  const fadable = new Set();
  const hideable = new Set(MODS.flatMap((mod) => mod.hide || []));
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const see = new Set(["glass", "tint", "lens", "sticker"]);
  car.traverse((o) => {
    if (!o.isMesh) return;
    const k = o.userData.mat;
    const part = o.userData.part;
    let m = base[k] || base.trim;
    if (k === "sticker") {
      // Each sticker and plate paints its own canvas.
      const spec = o.userData.sticker;
      m = new MeshStandardMaterial({
        map: stickerTexture(spec, aniso),
        transparent: !spec.bg,
        depthWrite: Boolean(spec.bg),
        alphaTest: 0.02,
        roughness: spec.bg ? 0.35 : 0.6,
        side: DoubleSide,
      });
    }
    if (part) {
      const id = `${k}:${part}`;
      if (!clones.has(id)) clones.set(id, m.clone());
      m = clones.get(id);
      if (!byPart.has(part)) byPart.set(part, new Set());
      byPart.get(part).add(m);
    }
    o.material = m;
    m.userData.key = k;
    if (SHELL.has(k)) shells.add(m);
    if (SHELL.has(k) || hideable.has(k)) fadable.add(m);
    if (!see.has(k)) o.castShadow = true;
    if (see.has(k)) o.renderOrder = k === "sticker" ? 3 : 2;
  });
  for (const m of fadable) {
    m.userData.opacity = m.opacity;
    m.userData.transparent = m.transparent;
    m.userData.depthWrite = m.depthWrite;
  }
  scene.add(car);

  const partToMod = new Map();
  for (const mod of MODS) for (const p of mod.parts) partToMod.set(p, mod.id);

  /* --- state --- */
  const intro = reducedMotion ? OVERVIEW : { ...OVERVIEW, yaw: OVERVIEW.yaw - 70, dist: OVERVIEW.dist + 3.5, pitch: 4 };
  const cur = { ...intro, target: new Vector3(...OVERVIEW.target) };
  const goal = { ...OVERVIEW, target: new Vector3(...OVERVIEW.target) };
  const reveal = { hood: 0, xray: 0, cabin: 0, hide: 0 };
  const revealGoal = { hood: 0, xray: 0, cabin: 0, hide: 0 };
  let hideKeys = new Set();
  let selected = null;
  let hovered = null;
  let spin = !reducedMotion;
  let dragging = null;
  let dirty = true;
  let visible = true;
  let raf = 0;
  let last = 0;
  let clock = 0;

  const setView = (v, cut) => {
    goal.yaw = v.yaw;
    goal.pitch = v.pitch;
    goal.dist = v.dist;
    goal.target.set(...v.target);
    if (cut || reducedMotion) {
      cur.yaw = v.yaw;
      cur.pitch = v.pitch;
      cur.dist = v.dist;
      cur.target.copy(goal.target);
    }
    wake();
  };

  /* --- highlight --- */
  const glowParts = () => {
    const sel = selected ? MOD_BY_ID[selected].parts : [];
    const hov = hovered && hovered !== selected ? MOD_BY_ID[hovered].parts : [];
    const pulse = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(clock * 3.2);
    for (const [part, mats] of byPart) {
      const level = sel.includes(part) ? 0.22 + 0.28 * pulse : hov.includes(part) ? 0.22 : 0;
      for (const m of mats) {
        const tint = part === "wrap" ? SHEEN : ACCENT;
        m.emissive.copy(tint);
        m.emissiveIntensity = part === "wrap" ? level * 0.35 : level;
      }
    }
  };

  /* --- reveals --- */
  const applyReveals = () => {
    car.userData.openHood(easeInOut(reveal.hood));
    const lit = new Set(selected ? MOD_BY_ID[selected].parts.flatMap((p) => [...(byPart.get(p) || [])]) : []);
    for (const m of fadable) {
      if (lit.has(m)) continue;
      const k = m.userData.key;
      let o = m.userData.opacity;
      if (reveal.xray > 0 && shells.has(m)) o *= 1 - 0.88 * reveal.xray;
      if (reveal.cabin > 0 && (k === "glass" || k === "tint")) o *= 1 - 0.88 * reveal.cabin;
      if (reveal.hide > 0 && hideKeys.has(k)) o *= 1 - 0.92 * reveal.hide;
      const fading = o < m.userData.opacity - 1e-3;
      const transparent = m.userData.transparent || fading;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = o;
      m.depthWrite = fading ? false : m.userData.depthWrite;
    }
  };

  /* --- loop --- */
  const approach = (a, b, dt, rate) => a + (b - a) * (1 - Math.exp(-dt * rate));
  const settled = () =>
    Math.abs(angleDelta(cur.yaw, goal.yaw)) < 0.02 &&
    Math.abs(cur.pitch - goal.pitch) < 0.02 &&
    Math.abs(cur.dist - goal.dist) < 0.002 &&
    cur.target.distanceTo(goal.target) < 0.001 &&
    Object.keys(reveal).every((k) => Math.abs(reveal[k] - revealGoal[k]) < 0.001);

  function frame(now) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    clock += dt;

    if (spin && !selected && !dragging) goal.yaw += SPIN_DEG_S * dt;
    cur.yaw += angleDelta(cur.yaw, goal.yaw) * (1 - Math.exp(-dt * EASE_RATE));
    cur.pitch = approach(cur.pitch, goal.pitch, dt, EASE_RATE);
    cur.dist = approach(cur.dist, goal.dist, dt, EASE_RATE);
    cur.target.lerp(goal.target, 1 - Math.exp(-dt * EASE_RATE));
    for (const k of Object.keys(reveal)) {
      reveal[k] = reducedMotion ? revealGoal[k] : approach(reveal[k], revealGoal[k], dt, REVEAL_RATE);
      if (Math.abs(reveal[k] - revealGoal[k]) < 0.001) reveal[k] = revealGoal[k];
    }

    const { position } = cameraFrom({ ...cur, target: cur.target.toArray() });
    camera.position.set(...position);
    camera.lookAt(cur.target);
    applyReveals();
    glowParts();
    renderer.render(scene, camera);

    const animating = !settled() || (spin && !selected) || (selected && !reducedMotion) || dirty;
    dirty = false;
    if (animating) raf = requestAnimationFrame(frame);
    else last = 0;
  }

  function wake() {
    dirty = true;
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }

  /* --- size & visibility --- */
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow screens pull the camera back so the whole car stays in frame.
    camera.fov = w / h < 1.1 ? 40 : 30;
    camera.updateProjectionMatrix();
    wake();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting && !document.hidden;
    if (visible) wake();
  });
  io.observe(canvas);
  const onVisibility = () => {
    visible = !document.hidden;
    if (visible) wake();
  };
  document.addEventListener("visibilitychange", onVisibility);

  /* --- pointer: drag to orbit, click to pick, hover to preview --- */
  const ray = new Raycaster();
  const ndc = new Vector2();
  const pickAt = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObject(car, true)) {
      const m = hit.object;
      // Clicks go through glass and through anything the x-ray has faded.
      if (see.has(m.userData.mat) || m.material.opacity < 0.3) continue;
      return m.userData.part ? partToMod.get(m.userData.part) || null : null;
    }
    return null;
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    dragging = { x: e.clientX, y: e.clientY, yaw: goal.yaw, pitch: goal.pitch, moved: false, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  };
  let hoverQueued = null;
  const onMove = (e) => {
    if (dragging && e.pointerId === dragging.id) {
      const dx = e.clientX - dragging.x;
      const dy = e.clientY - dragging.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragging.moved = true;
      if (!dragging.moved) return;
      goal.yaw = dragging.yaw + dx * 0.32;
      if (e.pointerType !== "touch") goal.pitch = clamp(dragging.pitch + dy * 0.22, -2, 72);
      canvas.style.cursor = "grabbing";
      wake();
      return;
    }
    if (e.pointerType !== "mouse") return;
    if (!hoverQueued) {
      requestAnimationFrame(() => {
        const id = pickAt(hoverQueued.x, hoverQueued.y);
        hoverQueued = null;
        canvas.style.cursor = id ? "pointer" : "grab";
        if (id !== hovered) {
          hovered = id;
          onHover?.(id);
          wake();
        }
      });
    }
    hoverQueued = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const { moved } = dragging;
    dragging = null;
    canvas.style.cursor = "";
    if (!moved) {
      const id = pickAt(e.clientX, e.clientY);
      if (id) onPick?.(id);
    }
    wake();
  };
  const onCancel = () => {
    dragging = null;
    canvas.style.cursor = "";
  };
  const onLeave = () => {
    if (hovered) {
      hovered = null;
      onHover?.(null);
      wake();
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("pointerleave", onLeave);

  wake();

  return {
    /** Frame a mod (or null for the resting view) and run its reveal. */
    select(id) {
      const mod = id ? MOD_BY_ID[id] : null;
      if ((mod ? mod.id : null) === selected) return;
      selected = mod ? mod.id : null;
      revealGoal.hood = mod?.reveal === "hood" ? 1 : 0;
      revealGoal.xray = mod?.reveal === "xray" ? 1 : 0;
      revealGoal.cabin = mod?.reveal === "cabin" ? 1 : 0;
      // Parts that hide this mod (the engine cover over the coils) fade out;
      // the last set is kept while it fades back in.
      revealGoal.hide = mod?.hide ? 1 : 0;
      if (mod?.hide) hideKeys = new Set(mod.hide);
      setView(mod ? mod.view : { ...OVERVIEW, yaw: cur.yaw }, false);
    },
    /** Light a mod's parts without moving the camera (the list's hover). */
    hover(id) {
      const next = id && MOD_BY_ID[id] ? id : null;
      if (next === hovered) return;
      hovered = next;
      wake();
    },
    setSpin(on) {
      spin = Boolean(on) && !reducedMotion;
      wake();
    },
    /** Back to the resting three-quarter view. */
    reset() {
      this.select(null);
      setView(OVERVIEW, false);
    },
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
        const mats = o.material ? [].concat(o.material) : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          for (const t of [m.map, m.emissiveMap]) {
            if (!t || seen.has(t)) continue;
            seen.add(t);
            t.dispose();
          }
          m.dispose();
        }
      });
      scene.environment?.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

/** Signed shortest difference b - a in degrees. */
function angleDelta(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180;
}
