import { useEffect, useRef } from "react";
import "./LatticeField.css";

/*
 * LatticeField — the interactive centrepiece in the hero's right-hand space.
 *
 * The idea: `.lp-grid` already paints a 72px lattice across the page, masked to
 * fade out before it reaches this side. Rather than drop a foreign object into
 * the gap, this picks that same grid up where the mask drops it and gives it
 * physics — so the field reads as the page's own structure coming alive, not as
 * decoration parked next to it.
 *
 * Three layers, all driven by one shared force field so they never feel like
 * separate effects:
 *   1. Lattice nodes, sprung to their home intersections.
 *   2. Links between neighbours, which brighten and shift along the
 *      blue -> sage -> coral signature as they stretch.
 *   3. Free particles advected through the same field, drawn as short trails.
 *
 * Forces: a spring home, a slow ambient breath, pointer repulsion with a
 * tangential swirl, and click shockwaves that ripple outward as expanding
 * annuli.
 *
 * Canvas rather than DOM/SVG: a few hundred nodes plus their links is far past
 * what is sane to animate as elements, and CLAUDE.md §5's transform/opacity
 * rule exists to avoid layout and paint — a single canvas has neither.
 */

/* ---- tuning ---------------------------------------------------------- */
const SPACING = 72; // matches .lp-grid's background-size
const SPRING = 0.016;
const DAMP = 0.92;
const AMBIENT = 0.05;

const POINTER_RADIUS = 260;
// A node sits where the spring balances the push, at roughly
// POINTER_FORCE / SPRING px from home — so 1.2 lands on ~75px, about one
// cell. Much higher and neighbouring rows cross over each other and the
// lattice stops reading as a grid.
const POINTER_FORCE = 1.2;
const SWIRL = 0.85; // tangential component — turns the push into a rotation

const WAVE_SPEED = 7.2; // px per frame
const WAVE_BAND = 90; // thickness of the travelling annulus
const WAVE_FORCE = 3.2; // impulse, not a sustained push — the band moves on
const WAVE_LIFE = 90; // frames

const PARTICLES = 190;
const PARTICLE_SPEED = 0.9;

const MAX_STRETCH = 46; // displacement at which a node/link is fully hot

/* ---- colour ---------------------------------------------------------- */
const FALLBACK = ["#6e93ff", "#6f9a5e", "#ff5d3b"];

const hexToRgb = (hex) => {
  const h = String(hex).trim().replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  if (h.length >= 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
};

const lerp = (a, b, t) => a + (b - a) * t;

/** Sample the blue -> sage -> coral ramp at t (0..1). */
const ramp = (stops, t) => {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  const lo = c < 0.5 ? stops[0] : stops[1];
  const hi = c < 0.5 ? stops[1] : stops[2];
  const k = c < 0.5 ? c * 2 : (c - 0.5) * 2;
  return [
    Math.round(lerp(lo[0], hi[0], k)),
    Math.round(lerp(lo[1], hi[1], k)),
    Math.round(lerp(lo[2], hi[2], k)),
  ];
};

const rgba = (c, a) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";

const LatticeField = () => {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const hintRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;

    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    let nodes = [];
    let links = [];
    let particles = [];
    let waves = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let frame = 0;
    let last = 0;
    let visible = true;
    let stops = FALLBACK.map(hexToRgb);

    const pointer = { x: -9999, y: -9999, strength: 0, target: 0 };
    const force = [0, 0];

    /* -- palette, read from the page so light/dark stay in sync -------- */
    const readPalette = () => {
      const host = wrap.closest(".lp") || wrap;
      const cs = getComputedStyle(host);
      stops = ["--blue", "--sage", "--accent"].map(
        (v, i) => hexToRgb(cs.getPropertyValue(v)) || hexToRgb(FALLBACK[i])
      );
    };

    const spawn = () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      px: 0,
      py: 0,
      life: 60 + Math.random() * 240,
      hue: Math.random(),
    });

    /* -- build ---------------------------------------------------------- */
    const build = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      if (!w || !h) return;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Centre the lattice in the box so it never sits flush against an edge.
      const cols = Math.max(2, Math.floor(w / SPACING));
      const rows = Math.max(2, Math.floor(h / SPACING));
      const offX = (w - (cols - 1) * SPACING) / 2;
      const offY = (h - (rows - 1) * SPACING) / 2;

      nodes = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const hx = offX + c * SPACING;
          const hy = offY + r * SPACING;
          nodes.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, d: 0 });
        }
      }

      // Right and down neighbours only, so every edge is stored once.
      links = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const i = r * cols + c;
          if (c < cols - 1) links.push([i, i + 1]);
          if (r < rows - 1) links.push([i, i + cols]);
        }
      }

      particles = [];
      for (let i = 0; i < PARTICLES; i += 1) particles.push(spawn());
    };

    /* -- the shared force field ----------------------------------------- */
    // Everything on screen is pushed by this one function, which is what keeps
    // the three layers reading as a single system rather than three effects.
    const field = (x, y, t, out) => {
      let fx = Math.sin(y * 0.009 + t * 1.7) * AMBIENT;
      let fy = Math.cos(x * 0.011 - t * 1.3) * AMBIENT;

      if (pointer.strength > 0.001) {
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < POINTER_RADIUS * POINTER_RADIUS) {
          const d = Math.sqrt(d2) || 1;
          const falloff = 1 - d / POINTER_RADIUS;
          const f = falloff * falloff * POINTER_FORCE * pointer.strength;
          const nx = dx / d;
          const ny = dy / d;
          fx += nx * f - ny * f * SWIRL;
          fy += ny * f + nx * f * SWIRL;
        }
      }

      for (let i = 0; i < waves.length; i += 1) {
        const wv = waves[i];
        const dx = x - wv.x;
        const dy = y - wv.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const off = d - wv.age * WAVE_SPEED;
        if (off < WAVE_BAND && off > -WAVE_BAND) {
          const band = 1 - (off < 0 ? -off : off) / WAVE_BAND;
          const life = 1 - wv.age / WAVE_LIFE;
          const f = band * band * life * WAVE_FORCE;
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        }
      }

      out[0] = fx;
      out[1] = fy;
    };

    /* -- step ----------------------------------------------------------- */
    const step = (dt, t) => {
      pointer.strength += (pointer.target - pointer.strength) * 0.08;

      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        field(n.x, n.y, t, force);
        const ax = (n.hx - n.x) * SPRING + force[0];
        const ay = (n.hy - n.y) * SPRING + force[1];
        n.vx = (n.vx + ax * dt) * DAMP;
        n.vy = (n.vy + ay * dt) * DAMP;
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        const ddx = n.x - n.hx;
        const ddy = n.y - n.hy;
        n.d = Math.sqrt(ddx * ddx + ddy * ddy);
      }

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        p.px = p.x;
        p.py = p.y;
        field(p.x, p.y, t, force);
        // A slow curling base flow keeps them moving when the pointer is
        // elsewhere, so the field is never completely still.
        p.x += (force[0] * 1.6 + Math.sin(p.y * 0.006 + t) * PARTICLE_SPEED) * dt;
        p.y += (force[1] * 1.6 + Math.cos(p.x * 0.005 - t) * PARTICLE_SPEED) * dt;
        p.life -= dt;
        if (
          p.life <= 0 ||
          p.x < -20 ||
          p.x > w + 20 ||
          p.y < -20 ||
          p.y > h + 20
        ) {
          particles[i] = spawn();
        }
      }

      for (let i = waves.length - 1; i >= 0; i -= 1) {
        waves[i].age += dt;
        if (waves[i].age > WAVE_LIFE) waves.splice(i, 1);
      }
    };

    /* -- draw ----------------------------------------------------------- */
    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      ctx.lineWidth = 1;
      for (let i = 0; i < links.length; i += 1) {
        const a = nodes[links[i][0]];
        const b = nodes[links[i][1]];
        const heat = Math.min(1, ((a.d + b.d) * 0.5) / MAX_STRETCH);
        ctx.strokeStyle = rgba(ramp(stops, heat), 0.07 + heat * 0.65);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Particles are drawn as the segment they travelled this frame, which
      // gives a trail for free without compositing a fading buffer.
      ctx.lineWidth = 1.1;
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        ctx.strokeStyle = rgba(ramp(stops, p.hue), 0.5);
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const heat = Math.min(1, n.d / MAX_STRETCH);
        ctx.fillStyle = rgba(ramp(stops, heat), 0.25 + heat * 0.7);
        ctx.beginPath();
        ctx.arc(n.x, n.y, 1 + heat * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    /* -- loop ----------------------------------------------------------- */
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      const delta = last ? now - last : 16.67;
      last = now;
      const dt = Math.min(delta / 16.67, 2.5); // clamp after a tab switch
      frame += dt;
      step(dt, frame * 0.006);
      draw();
    };

    /* -- input ----------------------------------------------------------- */
    // Listeners live on the window and convert into canvas space, so the canvas
    // itself stays pointer-events:none and can never intercept a nav click.
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      pointer.x = x;
      pointer.y = y;
      const near =
        x > -POINTER_RADIUS &&
        x < r.width + POINTER_RADIUS &&
        y > -POINTER_RADIUS &&
        y < r.height + POINTER_RADIUS;
      pointer.target = near ? 1 : 0;
      if (near && hintRef.current) hintRef.current.dataset.seen = "true";
    };

    const onLeave = () => {
      pointer.target = 0;
    };

    const onDown = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (x < 0 || y < 0 || x > r.width || y > r.height) return;
      waves.push({ x, y, age: 0 });
      if (waves.length > 5) waves.shift();
    };

    /* -- lifecycle ------------------------------------------------------- */
    const start = () => {
      readPalette();
      build();
      if (reduce.matches) {
        // One composed still frame, no loop, no listeners.
        draw();
        return;
      }
      last = 0;
      if (!raf) raf = requestAnimationFrame(loop);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      window.addEventListener("pointerleave", onLeave, { passive: true });
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerleave", onLeave);
    };

    const onResize = () => {
      readPalette();
      build();
      if (reduce.matches) draw();
    };

    const onVisibility = () => {
      visible = !document.hidden;
      last = 0;
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);

    // Pause entirely when scrolled out of view — a field nobody can see has no
    // business holding a rAF loop open.
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        last = 0;
      },
      { threshold: 0 }
    );
    io.observe(wrap);

    // A theme flip rewrites --blue/--sage/--accent on .lp; re-read them.
    const mo = new MutationObserver(readPalette);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const onReduceChange = () => {
      stop();
      start();
    };
    if (reduce.addEventListener)
      reduce.addEventListener("change", onReduceChange);

    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      if (reduce.removeEventListener)
        reduce.removeEventListener("change", onReduceChange);
    };
  }, []);

  return (
    <div className="lp-lattice" ref={wrapRef} aria-hidden="true">
      <canvas ref={canvasRef} className="lp-lattice-canvas" />
      <span className="lp-lattice-hint" ref={hintRef}>
        MOVE / CLICK
      </span>
    </div>
  );
};

export default LatticeField;
