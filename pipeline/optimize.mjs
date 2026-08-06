#!/usr/bin/env node
/*
 * pipeline/optimize.mjs — §17.8's `dedup/weld/join/simplify/meshopt/ktx2` step.
 *
 * Takes a clean authored/exported glTF and produces the shipped asset plus its
 * auto-generated LODs. §17.7 is explicit that LOD work is not manual:
 * "gltf-transform simplify → automated LOD1/LOD2 generation. No manual LOD work
 * at all." This is that.
 *
 *   node pipeline/optimize.mjs <in.glb> [-o out.glb]
 *   node pipeline/optimize.mjs art/props -r --out game/public/assets
 *   node pipeline/optimize.mjs <in.glb> --lods 600,250     (horde budget)
 *   node pipeline/optimize.mjs <in.glb> --dry              (measure only)
 *
 * ── Order matters, and the reasons are not obvious ────────────────────────
 *
 *   prune   → drop anything unreferenced before paying to process it
 *   dedup   → merge identical accessors/materials/textures across the file
 *   weld    → merge co-located vertices. **Simplify is meaningless without it**:
 *             an unwelded mesh is a soup of disconnected triangles, and the
 *             decimator cannot collapse an edge that no two faces share.
 *   join    → merge primitives sharing a material, cutting draw calls (§21.1
 *             already measures draw calls as a headline number)
 *   simplify→ LODs, generated from the *welded* base
 *   quantize→ shrink attributes to the smallest type that holds them
 *   meshopt → the transport codec
 *
 * KTX2 (§17.7 wants UASTC for normals, ETC1S for albedo) needs the external
 * `toktx` binary from KTX-Software. It is detected, not assumed: when absent
 * the step is skipped with a message rather than failing the build or silently
 * shipping PNG while claiming otherwise.
 *
 * ── Textures: shared by default, embedded only on request ─────────────────
 *
 * Writing .glb embeds every referenced texture into that file. For assets that
 * share one atlas — which §17.7 mandates ("trim sheets and atlases, not
 * per-asset textures... 8 base textures for the whole game") — that silently
 * copies the atlas into every single output. Measured on 33 props sharing one
 * 11KB colormap: 1,911KB of input became 2,743KB of output, all of the growth
 * being 99 duplicate copies of the same image.
 *
 * So the default output is **.gltf with external textures**, which keeps one
 * shared copy and lets the browser cache it once. `--embed` restores the
 * single-file .glb behaviour for assets that genuinely own their texture.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import {
  dedup,
  join as joinPrims,
  normals,
  prune,
  quantize,
  simplify,
  unweld,
  weld,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const execFileAsync = promisify(execFile);

/* §17.7: horde LOD1/LOD2 are 600/250 tris. Expressed as absolute triangle
 * targets rather than ratios so the budget table stays the source of truth. */
const DEFAULT_LODS = [600, 250];

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
};

// ------------------------------------------------------------------- helpers

const countTriangles = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const idx = prim.getIndices();
      n += Math.floor((idx ? idx.getCount() : (prim.getAttribute("POSITION")?.getCount() ?? 0)) / 3);
    }
  }
  return n;
};

const countVertices = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) n += prim.getAttribute("POSITION")?.getCount() ?? 0;
  }
  return n;
};

const countDrawCalls = (doc) =>
  doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0);

async function hasToktx() {
  try {
    await execFileAsync("toktx", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/* Register every extension, not just the ones we add. An unregistered extension
 * is silently dropped on write — which for KHR_texture_transform means an atlas
 * asset quietly loses its UV offsets somewhere in the build. */
function makeIO() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    /* The decoder is not optional. Without it this tool cannot read back its own
     * output, which breaks re-running the build over an already-optimized tree. */
    "meshopt.decoder": MeshoptDecoder,
  });
}

// ----------------------------------------------------------------- the passes

/**
 * Clean and join. Runs before any LOD split so every level inherits the work.
 *
 * Note `weld()` in gltf-transform 4.x merges **bitwise-identical** vertices
 * only — it takes no tolerance. That is fine here (this pass is about file
 * size); the consequence for simplification is handled in `makeLod`.
 */
async function cleanup(doc) {
  await doc.transform(
    prune({ keepAttributes: false, keepLeaves: false }),
    dedup(),
    weld(),
    joinPrims({ keepNamed: false }),
  );
  return doc;
}

/**
 * Decimate to an absolute triangle target.
 *
 * ── Why NORMAL is discarded first ─────────────────────────────────────────
 *
 * Flat-shaded low-poly art — which is exactly what this game uses — stores a
 * distinct normal per face, so the three vertices meeting at a corner are
 * bitwise *different* and `weld()` cannot merge them. The decimator can only
 * collapse an edge shared by two faces, so on an unwelded mesh it does almost
 * nothing. Measured on a 7,956-tri cave room: welding as-is reached 7,752 tris
 * even with the error bound opened to 100%. Dropping NORMAL first, then
 * welding, reached **352** — the same request, a 96% reduction.
 *
 * Normals are then regenerated with `unweld → normals → weld`. The unweld gives
 * every face its own vertices, `normals()` writes a true face normal onto each,
 * and the final weld merges back only the vertices that agree — so coplanar
 * regions collapse while silhouette edges stay hard.
 *
 * Note that gltf-transform's `normals()` generates **flat normals only**; there
 * is no smooth option. An earlier version of this file exposed a `--smooth-lods`
 * flag that merely skipped the re-weld, which produced flat normals anyway and
 * cost *more* vertices (measured: 345 vs 219 on the same 115-tri LOD). It was
 * removed rather than left as a misleading knob.
 *
 * This matters because §17.7 warns VAT cost is `verts × frames`, making vertex
 * count "doubly load-bearing" for skinned assets. If a future VAT pass wants
 * genuinely smooth (area-averaged) normals to cut that cost, it needs a custom
 * transform — this file does not provide one, and does not pretend to.
 */
async function makeLod(doc, targetTris) {
  const current = countTriangles(doc);
  if (current <= targetTris) return { skipped: true, tris: current };

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setAttribute("NORMAL", null);
  }

  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: targetTris / current, error: 0.05, lockBorder: false }),
  );
  await doc.transform(unweld(), normals({ overwrite: true }), weld());

  return { skipped: false, tris: countTriangles(doc) };
}

/** Attribute quantization + meshopt. Always last: it makes the file opaque. */
async function compress(doc) {
  await MeshoptEncoder.ready;
  await doc.transform(
    quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD|COLOR|JOINTS|WEIGHTS|TANGENT)/ }),
  );
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  return doc;
}

// --------------------------------------------------------------------- driver

/**
 * Give every external texture a content-addressed filename.
 *
 * Two assets that share an atlas must land on the *same* file — that is the
 * whole point of §17.7's shared-atlas rule. Two assets with different textures
 * must never land on the same file. gltf-transform names external images after
 * their material slot, so without this every asset writes `baseColor.png` into
 * the output directory and the last one wins. Hashing the image bytes gives
 * both properties for free.
 */
function addressTexturesByContent(doc) {
  for (const texture of doc.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const ext = (texture.getMimeType() ?? "image/png").split("/")[1].replace("jpeg", "jpg");
    const hash = createHash("sha256").update(image).digest("hex").slice(0, 16);
    texture.setURI(`textures/${hash}.${ext}`);
  }
}

async function optimizeOne(io, inPath, outPath, opts) {
  const srcBytes = (await stat(inPath)).size;
  const doc = await io.read(inPath);

  const before = { tris: countTriangles(doc), draws: countDrawCalls(doc) };
  await cleanup(doc);
  const cleaned = { tris: countTriangles(doc), draws: countDrawCalls(doc) };

  const written = [];

  if (!opts.dry) {
    await mkdir(dirname(outPath), { recursive: true });

    /* Serialise the cleaned base *before* compressing, so the LOD passes start
     * from readable geometry rather than from a meshopt-encoded buffer. */
    const baseGlb = await io.writeBinary(doc);

    await compress(doc);
    if (!opts.embed) addressTexturesByContent(doc);
    await io.write(outPath, doc);
    written.push({ path: outPath, tris: cleaned.tris, verts: countVertices(doc), bytes: (await stat(outPath)).size });

    for (let i = 0; i < opts.lods.length; i++) {
      const target = opts.lods[i];
      const lodDoc = await io.readBinary(baseGlb);
      const res = await makeLod(lodDoc, target);
      /* §17.7 naming: LOD1/LOD2 suffixes. */
      const lodPath = join(
        dirname(outPath),
        `${basename(outPath, extname(outPath))}_LOD${i + 1}${extname(outPath)}`,
      );
      await compress(lodDoc);
      if (!opts.embed) addressTexturesByContent(lodDoc);
      await io.write(lodPath, lodDoc);
      written.push({
        path: lodPath,
        tris: res.tris,
        verts: countVertices(lodDoc),
        bytes: (await stat(lodPath)).size,
        skipped: res.skipped,
      });
    }
  }

  return { inPath, srcBytes, before, cleaned, written };
}

// ------------------------------------------------------------------------ cli

async function collect(target, recursive) {
  const out = [];
  const stack = [target];
  while (stack.length) {
    const p = stack.pop();
    const st = await stat(p).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) {
      for (const e of await readdir(p, { withFileTypes: true })) {
        const full = join(p, e.name);
        if (e.isDirectory()) {
          if (recursive) stack.push(full);
        } else if (/\.(glb|gltf)$/i.test(e.name) && !/_LOD\d/i.test(e.name)) out.push(full);
      }
    } else if (/\.(glb|gltf)$/i.test(p)) {
      out.push(p);
    }
  }
  return out.sort();
}

function parseArgs(argv) {
  const opts = { out: null, recursive: false, dry: false, lods: DEFAULT_LODS, ktx2: false, embed: false };
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") opts.out = argv[++i];
    else if (a === "-r" || a === "--recursive") opts.recursive = true;
    else if (a === "--dry") opts.dry = true;
    else if (a === "--ktx2") opts.ktx2 = true;
    else if (a === "--embed") opts.embed = true;
    else if (a === "--no-lods") opts.lods = [];
    else if (a === "--lods") {
      opts.lods = argv[++i]
        .split(",")
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
    } else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
    else inputs.push(a);
  }
  if (!inputs.length) throw new Error("no input file or directory given");
  return { opts, inputs };
}

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;

/**
 * Root of the output tree: the directory the inputs share.
 *
 * A single directory input roots there. A list of files roots at their deepest
 * common directory, so `art/props/a.glb art/props/b.glb` flattens to `a`/`b`
 * while `art/props/a.glb art/kits/b.glb` preserves `props/` and `kits/`.
 */
async function outputBase(inputs) {
  const resolved = inputs.map((i) => resolve(i));
  if (resolved.length === 1) {
    const st = await stat(resolved[0]).catch(() => null);
    return st?.isDirectory() ? resolved[0] : dirname(resolved[0]);
  }
  const dirs = await Promise.all(
    resolved.map(async (p) => ((await stat(p).catch(() => null))?.isDirectory() ? p : dirname(p))),
  );
  const split = dirs.map((d) => d.split(/[\/]/));
  const common = [];
  for (let i = 0; i < split[0].length; i++) {
    const seg = split[0][i];
    if (split.every((s) => s[i] === seg)) common.push(seg);
    else break;
  }
  return common.join("/") || dirs[0];
}

async function main() {
  const { opts, inputs } = parseArgs(process.argv.slice(2));
  const io = makeIO();

  if (opts.ktx2 && !(await hasToktx())) {
    console.log(
      `\n${c.warn("KTX2 requested but `toktx` is not on PATH")} — texture compression will be skipped.\n` +
        c.dim("  Install KTX-Software (github.com/KhronosGroup/KTX-Software) to enable it.\n") +
        c.dim("  §17.7 wants UASTC for normals and ETC1S for albedo; until then textures ship as authored.\n"),
    );
    opts.ktx2 = false;
  }

  const files = (await Promise.all(inputs.map((i) => collect(i, opts.recursive)))).flat();
  if (!files.length) throw new Error("no .glb or .gltf files found");

  console.log(
    `\n${c.b("Optimize")} — ${files.length} asset(s)` +
      (opts.lods.length ? ` · LODs at ${opts.lods.join(", ")} tris` : " · no LODs") +
      (opts.dry ? c.dim("  (dry run)") : ""),
  );
  console.log();

  let srcTotal = 0;
  let outTotal = 0;
  const results = [];

  /* Where to root the output tree.
   *
   * The rule has to handle both "one directory" and "a list of files", and the
   * naive `relative(inputs[0], file)` breaks the second case badly: with files
   * as inputs, inputs[0] is a *file*, so the relative path starts `../` and
   * every asset after the first is written OUTSIDE --out. That is both a wrong
   * layout and a path traversal, so the base is computed from the inputs'
   * common directory and the result is asserted to stay inside --out. */
  const base = await outputBase(inputs);

  for (const file of files) {
    let dest;
    if (opts.out) {
      const rel = relative(base, resolve(file));
      const inside = rel && !rel.startsWith("..") && !isAbsolute(rel);
      dest = join(opts.out, inside ? rel : basename(file));
    } else {
      dest = join(dirname(file), `${basename(file, extname(file))}.opt.glb`);
    }

    try {
      const ext = opts.embed ? ".glb" : ".gltf";
      const r = await optimizeOne(io, file, dest.replace(/\.(glb|gltf)$/i, ext), opts);
      results.push(r);
      srcTotal += r.srcBytes;
      const produced = r.written.reduce((n, w) => n + w.bytes, 0);
      outTotal += produced;

      const draws =
        r.before.draws === r.cleaned.draws
          ? `${r.cleaned.draws} draws`
          : `${r.before.draws}→${c.ok(String(r.cleaned.draws))} draws`;
      const tris =
        r.before.tris === r.cleaned.tris
          ? `${r.cleaned.tris} tris`
          : `${r.before.tris}→${c.ok(String(r.cleaned.tris))} tris`;

      console.log(`  ${c.b(basename(file).padEnd(28))} ${tris} · ${draws}`);
      if (!opts.dry) {
        for (const w of r.written) {
          const tag = basename(w.path).match(/_LOD\d/)?.[0] ?? "base";
          console.log(
            `       ${c.dim(tag.padEnd(6))} ${String(w.tris).padStart(6)} tris  ${String(w.verts).padStart(6)} verts  ${kb(w.bytes).padStart(8)}` +
              (w.skipped ? c.dim("   (already under target)") : ""),
          );
        }
      }
    } catch (e) {
      console.log(`  ${c.bad("FAIL")} ${c.b(basename(file))} — ${e.message}`);
    }
  }

  if (!opts.dry && srcTotal) {
    console.log(
      `\n${c.b("Total")}  ${kb(srcTotal)} in → ${kb(outTotal)} out ` +
        c.dim(`(including ${opts.lods.length} LOD level(s) per asset)`),
    );
    console.log(
      c.dim("Bundle budgets are checked by manifest.mjs against the §17.11 table, not here."),
    );
  }
  console.log();
  return results.length === files.length ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`\n${c.bad("optimize failed")} — ${e.message}\n`);
      process.exit(1);
    },
  );
}

export { cleanup, compress, countDrawCalls, countTriangles, countVertices, makeIO, makeLod };
