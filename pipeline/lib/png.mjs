/*
 * pipeline/lib/png.mjs — a minimal, dependency-free PNG codec.
 *
 * Why not sharp: §21.2 note 3 already records `npm ci` breaking this build on
 * Windows because a native addon was held open. The art pipeline runs on the
 * same machine, so a native image dependency buys a decoder we don't need and
 * a class of failure we've already been bitten by. PNG is zlib plus five
 * scanline filters, and `node:zlib` ships in the runtime.
 *
 * Scope, deliberately narrow — every texture in the vendored packs is 8-bit
 * non-interlaced RGB/RGBA, so that is what this handles. Anything else throws
 * with a specific message rather than silently producing wrong pixels.
 */

import { deflateSync, inflateSync } from "node:zlib";

const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* CRC-32, as PNG specifies it. Table built once on first use. */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Decode an 8-bit non-interlaced PNG.
 * @returns {{width:number,height:number,channels:number,data:Buffer}} data is
 *   tightly packed, `channels` bytes per pixel, row-major, top-down.
 */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(MAGIC)) throw new Error("not a PNG (bad magic)");

  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  const idat = [];

  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);

    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colourType = body[9];
      if (body[12] !== 0) throw new Error("interlaced PNG is not supported");
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    off += 12 + len;
  }

  if (depth !== 8) throw new Error(`only 8-bit PNG is supported (got ${depth}-bit)`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  if (!channels) {
    throw new Error(
      `colour type ${colourType} is not supported ` +
        `(palette and unknown types are out of scope for this pipeline)`,
    );
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  /* Undo the per-scanline filters. Each row is prefixed with its filter byte;
   * `a` is the pixel to the left, `b` above, `c` above-left. */
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const dst = y * stride;
    const up = dst - stride;

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[up + x] : 0;
      const c = x >= channels && y > 0 ? out[up + x - channels] : 0;
      const v = row[x];
      let r;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      out[dst + x] = r & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/**
 * Encode 8-bit RGB/RGBA back to PNG.
 *
 * Per-row adaptive filtering using the standard minimum-sum-of-absolute-
 * differences heuristic. A fixed filter was tried first and measured 45% larger
 * on Kenney's flat palette atlas — flat art wants None, photogrammetry wants
 * Paeth, and one file can contain both.
 */
export function encodePng({ width, height, channels, data }) {
  if (channels !== 3 && channels !== 4) throw new Error("encode supports RGB or RGBA only");
  const colourType = channels === 4 ? 6 : 2;
  const stride = width * channels;

  const raw = Buffer.alloc((stride + 1) * height);
  const cand = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const src = y * stride;
    const dst = y * (stride + 1);
    const prev = src - stride;
    let bestFilter = 0;
    let bestScore = Infinity;

    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? data[src + x - channels] : 0;
        const b = y > 0 ? data[prev + x] : 0;
        const c = x >= channels && y > 0 ? data[prev + x - channels] : 0;
        const v = data[src + x];
        let r;
        switch (f) {
          case 0: r = v; break;
          case 1: r = v - a; break;
          case 2: r = v - b; break;
          case 3: r = v - ((a + b) >> 1); break;
          default: {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            r = v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          }
        }
        cand[x] = r & 0xff;
        /* Signed magnitude: bytes near 0 or 255 are cheap for deflate. */
        score += cand[x] < 128 ? cand[x] : 256 - cand[x];
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        cand.copy(best);
      }
    }

    raw[dst] = bestFilter;
    best.copy(raw, dst + 1);
  }

  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "ascii");
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;

  return Buffer.concat([
    MAGIC,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ colour helpers

/* sRGB ⇄ linear. Colour maths that averages or mixes must happen in linear
 * space; doing it on sRGB bytes darkens midtones in a way that reads as muddy
 * exactly where §17.1 wants clean value separation. */

const TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export const srgbToLinear = (b) => TO_LINEAR[b];

export function linearToSrgb(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

/** Rec. 709 relative luminance from linear RGB — the "value" of §17.1. */
export const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Oklab, for perceptually sane nearest-swatch search.
 *
 * Naive RGB distance picks visually wrong swatches — it will happily map a warm
 * mid-brown to `grave` grey because the numbers are close while the eye is not
 * fooled. Oklab keeps "nearest" meaning what a person means by it, which is the
 * whole point of a palette lock.
 */
export function linearToOklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToLinear(L, a, bb) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
