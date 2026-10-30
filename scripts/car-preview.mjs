#!/usr/bin/env node
/*
 * Headless preview of the Garage's code-built Golf R (src/Pages/Garage/car/).
 * Renders the model to PNGs with a small software rasteriser, so a change to
 * the shape can be looked at without opening a browser (CLAUDE.md §0). It is
 * not the real renderer: studio shading and flat colours per material key, no
 * textures, so stickers are left out and plates are blank. Every mesh is
 * there at its real size, though, which is what a shape check needs.
 *
 *   node scripts/car-preview.mjs [outDir] [--views a,b] [--size 960x560] [--reveal hood|xray|cabin]
 *
 * Views are the same yaw/pitch/distance/target rig the page's camera uses;
 * pass a mod id from mods.mjs as a view to frame that mod.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { Matrix3, Matrix4, PerspectiveCamera, Vector3 } from "three";
import { SHELL, buildCar } from "../src/Pages/Garage/car/model.mjs";
import { MODS, OVERVIEW, cameraFrom } from "../src/Pages/Garage/car/mods.mjs";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const outDir = resolve(args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) || "car-preview");
const [W, H] = flag("size", "960x560").split("x").map(Number);
const SS = 2;

const VIEWS = {
  three: OVERVIEW,
  side: { yaw: 90, pitch: 2, dist: 6.4, target: [0, 0.68, 0] },
  front: { yaw: 0, pitch: 4, dist: 5.6, target: [0, 0.68, 0] },
  rear: { yaw: 180, pitch: 6, dist: 5.6, target: [0, 0.68, 0] },
  rear3: { yaw: 145, pitch: 12, dist: 6.2, target: [0, 0.62, 0] },
  top: { yaw: 90, pitch: 89, dist: 7.5, target: [0, 0.6, 0] },
  low: { yaw: 50, pitch: -1, dist: 5.2, target: [0, 0.55, 0] },
};
for (const m of MODS) VIEWS[m.id] = { ...m.view, reveal: m.reveal, parts: m.parts, hide: m.hide };

const names = flag("views", "three,side,front,rear,rear3,top").split(",");

// Base colour (linear-ish 0..1), gloss (0..1), alpha.
const LOOK = {
  paint: [[0.2, 0.74, 0.86], 0.35, 1],
  tint: [[0.02, 0.03, 0.035], 0.6, 0.86],
  visor: [[0.03, 0.035, 0.04], 0.4, 0.9],
  forgedFlake: [[0.16, 0.17, 0.18], 0.5, 1],
  tip: [[0.06, 0.06, 0.07], 0.6, 1],
  machined: [[0.85, 0.86, 0.88], 0.5, 1],
  lug: [[0.75, 0.6, 0.28], 0.6, 1],
  sensor: [[0.32, 0.35, 0.38], 0.2, 1],
  cover: [[0.07, 0.07, 0.08], 0.2, 1],
  reservoir: [[0.86, 0.85, 0.8], 0.1, 1],
  under: [[0.07, 0.07, 0.08], 0, 1],
  trim: [[0.06, 0.06, 0.07], 0.15, 1],
  gloss: [[0.03, 0.03, 0.035], 0.5, 1],
  glass: [[0.05, 0.08, 0.1], 0.6, 0.55],
  lens: [[0.75, 0.8, 0.85], 0.7, 0.35],
  chrome: [[0.75, 0.77, 0.8], 0.9, 1],
  steel: [[0.62, 0.64, 0.67], 0.6, 1],
  tire: [[0.08, 0.08, 0.085], 0, 1],
  wheel: [[0.05, 0.05, 0.055], 0.5, 1],
  disc: [[0.42, 0.42, 0.43], 0.2, 1],
  caliper: [[0.1, 0.1, 0.11], 0.3, 1],
  carbon: [[0.12, 0.12, 0.13], 0.5, 1],
  forged: [[0.16, 0.16, 0.17], 0.5, 1],
  tail: [[0.6, 0.04, 0.05], 0.5, 1],
  amber: [[0.85, 0.45, 0.05], 0.4, 1],
  drl: [[1, 1, 1], 0, 1],
  engine: [[0.3, 0.31, 0.33], 0.3, 1],
  plastic: [[0.1, 0.1, 0.11], 0.1, 1],
  red: [[0.75, 0.06, 0.06], 0.4, 1],
  interior: [[0.13, 0.13, 0.14], 0, 1],
  leather: [[0.09, 0.09, 0.1], 0.1, 1],
  bay: [[0.18, 0.19, 0.2], 0, 1],
  plate: [[0.92, 0.93, 0.95], 0.1, 1],
  lamp: [[0.08, 0.09, 0.1], 0.5, 1],
  mirror: [[0.5, 0.55, 0.6], 0.9, 1],
  tailLed: [[1, 0.25, 0.2], 0, 1],
  inlet: [[0.08, 0.08, 0.09], 0.5, 1],
  blue: [[0.12, 0.35, 0.85], 0.3, 1],
  ecu: [[0.25, 0.27, 0.3], 0.3, 1],
};
const FALLBACK = [[1, 0, 1], 0, 1];

const L1 = new Vector3(0.35, 1, 0.45).normalize();
const L2 = new Vector3(-0.6, 0.35, -0.5).normalize();

function render(view, reveal) {
  const car = buildCar();
  if (reveal === "hood" || view.reveal === "hood") car.userData.openHood?.(1);
  car.updateMatrixWorld(true);
  const xray = reveal === "xray" || view.reveal === "xray";
  const cabin = reveal === "cabin" || view.reveal === "cabin";

  const w = W * SS;
  const h = H * SS;
  const cam = new PerspectiveCamera(30, W / H, 0.05, 100);
  const { position, target } = cameraFrom(view);
  cam.position.set(...position);
  cam.lookAt(new Vector3(...target));
  cam.updateMatrixWorld(true);
  const pv = new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

  const color = new Float32Array(w * h * 3);
  const depth = new Float32Array(w * h).fill(Infinity);
  for (let y = 0; y < h; y++) {
    const k = y / h;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      color[i] = 0.93 - k * 0.08;
      color[i + 1] = 0.94 - k * 0.08;
      color[i + 2] = 0.93 - k * 0.09;
    }
  }

  const tris = { opaque: [], clear: [] };
  const v = new Vector3();
  const nrm = new Vector3();
  const nm = new Matrix3();
  car.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let look = LOOK[o.userData.mat] || FALLBACK;
    if (o.userData.mat === "sticker") {
      // No canvas here: a plate shows as its background, text stickers not at all.
      const bg = o.userData.sticker.bg;
      if (!bg) return;
      look = [[1, 2, 3].map((i) => (parseInt(bg.slice(i * 2 - 1, i * 2 + 1), 16) / 255) ** 2.2), 0.1, 1];
    }
    if (o.userData.mat === "cover" && view.hide?.includes("cover")) look = [look[0], look[1], 0.1];
    const lit = view.parts?.includes(o.userData.part);
    if (xray && SHELL.has(o.userData.mat) && !lit) look = [look[0], look[1], 0.12];
    if (cabin && (o.userData.mat === "glass" || o.userData.mat === "tint")) look = [look[0], look[1], 0.12];
    const g = o.geometry;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    nm.getNormalMatrix(o.matrixWorld);
    const verts = [];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      const world = v.clone();
      v.applyMatrix4(pv);
      // applyMatrix4 divides by w; keep w for perspective-correct interpolation.
      const e = pv.elements;
      const cw = e[3] * world.x + e[7] * world.y + e[11] * world.z + e[15];
      nrm.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      verts.push({ sx: (v.x * 0.5 + 0.5) * w, sy: (1 - (v.y * 0.5 + 0.5)) * h, z: v.z, w: cw, world, n: nrm.clone() });
    }
    const index = g.index ? g.index.array : Array.from({ length: p.count }, (_, i) => i);
    const bucket = look[2] < 1 ? tris.clear : tris.opaque;
    for (let i = 0; i < index.length; i += 3) {
      const a = verts[index[i]];
      const b = verts[index[i + 1]];
      const c = verts[index[i + 2]];
      if (a.w <= 0.05 || b.w <= 0.05 || c.w <= 0.05) continue;
      bucket.push([a, b, c, look]);
    }
  });

  // Floor: soft contact shadow under the car.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Unproject the pixel onto y = 0.
      const ndc = new Vector3((x / w) * 2 - 1, 1 - (y / h) * 2, 0.5).unproject(cam);
      const dir = ndc.sub(cam.position).normalize();
      if (dir.y >= -1e-4) continue;
      const t = -cam.position.y / dir.y;
      const gx = cam.position.x + dir.x * t;
      const gz = cam.position.z + dir.z * t;
      const r = Math.hypot(gx / 2.35, gz / 1.05);
      const shade = 1 - 0.55 * Math.max(0, 1 - r) ** 1.4;
      const i = (y * w + x) * 3;
      color[i] *= shade;
      color[i + 1] *= shade;
      color[i + 2] *= shade;
    }
  }

  const toCam = new Vector3();
  const shadePixel = (look, world, n) => {
    toCam.copy(cam.position).sub(world).normalize();
    if (n.dot(toCam) < 0) n.negate();
    const [base, gloss] = look;
    const d1 = Math.max(0, n.dot(L1));
    const d2 = Math.max(0, n.dot(L2));
    const amb = 0.32 + 0.18 * n.y;
    const r = n.clone().multiplyScalar(2 * n.dot(toCam)).sub(toCam);
    const box = r.y > 0 ? Math.min(1, Math.max(0, (r.y - 0.35) / 0.3)) : 0;
    const fres = 0.04 + 0.96 * (1 - Math.max(0, n.dot(toCam))) ** 5;
    const spec = gloss * (0.85 * box + 0.25 * fres + 0.05);
    const lit = amb + 0.7 * d1 + 0.22 * d2;
    return [base[0] * lit + spec, base[1] * lit + spec, base[2] * lit + spec];
  };

  const raster = (tri, blend) => {
    const [a, b, c, look] = tri;
    const minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
    const minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));
    const area = (b.sx - a.sx) * (c.sy - a.sy) - (b.sy - a.sy) * (c.sx - a.sx);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const l0 = ((b.sx - px) * (c.sy - py) - (b.sy - py) * (c.sx - px)) / area;
        const l1 = ((c.sx - px) * (a.sy - py) - (c.sy - py) * (a.sx - px)) / area;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const z = l0 * a.z + l1 * b.z + l2 * c.z;
        const di = y * w + x;
        if (z >= depth[di]) continue;
        const q0 = l0 / a.w;
        const q1 = l1 / b.w;
        const q2 = l2 / c.w;
        const qs = q0 + q1 + q2;
        const world = new Vector3(
          (q0 * a.world.x + q1 * b.world.x + q2 * c.world.x) / qs,
          (q0 * a.world.y + q1 * b.world.y + q2 * c.world.y) / qs,
          (q0 * a.world.z + q1 * b.world.z + q2 * c.world.z) / qs
        );
        const n = new Vector3(
          q0 * a.n.x + q1 * b.n.x + q2 * c.n.x,
          q0 * a.n.y + q1 * b.n.y + q2 * c.n.y,
          q0 * a.n.z + q1 * b.n.z + q2 * c.n.z
        ).normalize();
        const col = shadePixel(look, world, n);
        const ci = di * 3;
        if (blend) {
          const al = look[2];
          color[ci] = color[ci] * (1 - al) + col[0] * al;
          color[ci + 1] = color[ci + 1] * (1 - al) + col[1] * al;
          color[ci + 2] = color[ci + 2] * (1 - al) + col[2] * al;
        } else {
          depth[di] = z;
          color[ci] = col[0];
          color[ci + 1] = col[1];
          color[ci + 2] = col[2];
        }
      }
    }
  };
  for (const t of tris.opaque) raster(t, false);
  const centroidDepth = (t) => (t[0].w + t[1].w + t[2].w) / 3;
  tris.clear.sort((p, q) => centroidDepth(q) - centroidDepth(p));
  for (const t of tris.clear) raster(t, true);

  // Downsample and encode.
  const out = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    out[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        for (let dy = 0; dy < SS; dy++)
          for (let dx = 0; dx < SS; dx++) s += color[((y * SS + dy) * w + x * SS + dx) * 3 + ch];
        const lin = Math.min(1, Math.max(0, s / (SS * SS)));
        out[y * (W * 3 + 1) + 1 + x * 3 + ch] = Math.round(lin ** (1 / 1.15) * 255);
      }
    }
  }
  return png(W, H, out);
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const name of names) {
  const view = VIEWS[name];
  if (!view) {
    console.error(`No view "${name}". Views: ${Object.keys(VIEWS).join(", ")}`);
    process.exitCode = 1;
    continue;
  }
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, render(view, flag("reveal")));
  console.log(file);
}
