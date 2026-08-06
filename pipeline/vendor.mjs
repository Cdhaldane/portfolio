#!/usr/bin/env node
/*
 * pipeline/vendor.mjs — pull the CC0 source packs listed in
 * `art-recipes/sources.jsonl` into `pipeline/vendor/`, assert their licences,
 * and record what was fetched in `art-recipes/sources.lock.json`.
 *
 * Why this exists: §22 R17 requires provenance for every asset that reaches the
 * game, and §22 R22 warns that the whole character pipeline hangs off free
 * third-party services. A committed ledger plus a lockfile of sha256s means a
 * pack that vanishes, moves, or quietly relicenses is a build failure rather
 * than a discovery made six months later.
 *
 * The ledger is the source of truth. This script never invents a URL.
 *
 *   node pipeline/vendor.mjs                 fetch everything not already local
 *   node pipeline/vendor.mjs --list          show the ledger, no network
 *   node pipeline/vendor.mjs --only a,b      fetch just these ids
 *   node pipeline/vendor.mjs --check         verify local files against the lock
 *   node pipeline/vendor.mjs --force         re-fetch even if present
 *   node pipeline/vendor.mjs --extract       unzip archives after fetching
 *
 * Zero dependencies — node: builtins only, so it runs before any install.
 */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const LEDGER = join(ROOT, "art-recipes", "sources.jsonl");
const LOCK = join(ROOT, "art-recipes", "sources.lock.json");
const OUT = join(HERE, "vendor");
const DROP = join(OUT, "_drop");

const UA = "gallows-hymn-vendor/0.1 (+https://github.com/CharlieHaldane)";

/* The only licence this ledger is allowed to carry. Anything else is a bug in
 * the ledger, not a thing to shrug at — the CC0-only rule is what makes the
 * whole pile safe to ship in a public web build without an attribution audit. */
const ALLOWED_LICENCES = new Set(["CC0-1.0"]);

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const flags = new Set();
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a.startsWith("--only=")) only = a.slice(7).split(",").filter(Boolean);
    else if (a.startsWith("--")) flags.add(a.slice(2));
    else throw new Error(`unexpected argument: ${a}`);
  }
  return { flags, only };
}

// ---------------------------------------------------------------- ledger

async function readLedger() {
  const text = await readFile(LEDGER, "utf8");
  const rows = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("//")) return;
    let row;
    try {
      row = JSON.parse(t);
    } catch (e) {
      throw new Error(`sources.jsonl:${i + 1} is not valid JSON — ${e.message}`);
    }
    if (!row.id) throw new Error(`sources.jsonl:${i + 1} has no id`);
    /* `page` is where a human goes to re-check the licence claim, so a missing
     * one is a real defect rather than something to paper over with a guess. */
    if (!row.page) throw new Error(`sources.jsonl:${i + 1} (${row.id}) has no page URL`);
    if (!ALLOWED_LICENCES.has(row.licence)) {
      throw new Error(
        `sources.jsonl:${i + 1} (${row.id}) declares licence "${row.licence}"; ` +
          `this ledger is CC0-only`,
      );
    }
    rows.push(row);
  });
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) throw new Error(`duplicate id in sources.jsonl: ${r.id}`);
    seen.add(r.id);
  }
  return rows;
}

// ---------------------------------------------------------------- http

async function get(url, accept = "text/html,application/json") {
  const res = await fetch(url, { headers: { "user-agent": UA, accept } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}

const getText = async (url) => (await get(url)).text();
const getJson = async (url) => (await get(url, "application/json")).json();

// ---------------------------------------------------------------- resolvers
/*
 * A resolver turns a ledger row into a concrete download plan:
 *   { files: [{ url, name, md5? }], licenceEvidence: string }
 * `licenceEvidence` is a human-readable note about how the CC0 claim was
 * checked at fetch time. Where a resolver can verify it from the source, it
 * does, and throws when the source stops saying CC0.
 */

const resolvers = {
  /* Kenney's download URL carries a content hash that changes on every pack
   * revision, so it must be resolved from the page rather than pinned. */
  async kenney(row) {
    const page = `https://kenney.nl/assets/${row.slug}`;
    const html = await getText(page);
    if (!/Creative Commons CC0/i.test(html)) {
      throw new Error(
        `${row.id}: ${page} no longer declares "Creative Commons CC0" — ` +
          `re-check the licence before vendoring`,
      );
    }
    const m = html.match(/href=["']([^"']*\.zip)["']/);
    if (!m) throw new Error(`${row.id}: no .zip link found on ${page}`);
    return {
      files: [{ url: m[1], name: basename(new URL(m[1]).pathname) }],
      licenceEvidence: `page asserts "Creative Commons CC0" (${page})`,
    };
  },

  /* ambientCG is blanket CC0 for its own assets; the v2 API exposes no
   * per-asset licence field, so the claim is asserted from the ledger and the
   * evidence records that fact honestly rather than implying a check. */
  async ambientcg(row) {
    const api =
      `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(row.asset)}` +
      `&include=downloadData`;
    const j = await getJson(api);
    const asset = j.foundAssets?.[0];
    if (!asset) throw new Error(`${row.id}: ambientCG has no asset "${row.asset}"`);
    const want = `${row.resolution}-${row.format}`;
    const downloads =
      asset.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads ?? [];
    const hit = downloads.find((d) => d.attribute === want);
    if (!hit) {
      const have = downloads.map((d) => d.attribute).join(", ");
      throw new Error(`${row.id}: no "${want}" download; available: ${have}`);
    }
    return {
      files: [{ url: hit.downloadLink, name: `${row.asset}_${want}.zip` }],
      licenceEvidence: "ambientCG site-wide CC0 (no per-asset licence field in API v2)",
    };
  },

  /* Poly Haven's files API returns an md5 per file, so this is the one source
   * whose integrity can be checked against the publisher rather than only
   * against our own previous fetch. */
  async polyhaven(row) {
    const files = await getJson(`https://api.polyhaven.com/files/${row.asset}`);
    const bucket = row.assetType === "hdris" ? files.hdri : files[row.map ?? "Diffuse"];
    const entry = bucket?.[row.resolution]?.[row.format];
    if (!entry?.url) {
      throw new Error(
        `${row.id}: no ${row.resolution}/${row.format} in Poly Haven files for ${row.asset}`,
      );
    }
    return {
      files: [{ url: entry.url, name: basename(new URL(entry.url).pathname), md5: entry.md5 }],
      licenceEvidence: "Poly Haven site-wide CC0; md5 verified against publisher",
    };
  },

  /* A stable, publisher-hosted URL pinned in the ledger. */
  async direct(row) {
    if (!row.url) throw new Error(`${row.id}: resolver "direct" needs a url`);
    return {
      files: [{ url: row.url, name: decodeURIComponent(basename(new URL(row.url).pathname)) }],
      licenceEvidence: `pinned URL; licence asserted from ledger (see ${row.page ?? "page"})`,
    };
  },

  /* itch.io and Quaternius gate downloads behind JS, so these are dropped in by
   * hand. The script's job is then to confirm the drop happened and hash it, so
   * a manual source is still covered by the lockfile. */
  async manual(row) {
    return { files: [], manual: true, licenceEvidence: "manual drop; licence asserted from ledger" };
  },
};

// ---------------------------------------------------------------- fetch

async function sha256File(path) {
  const h = createHash("sha256");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

async function md5File(path) {
  const h = createHash("md5");
  await pipeline(createReadStream(path), h);
  return h.digest("hex");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  await mkdir(dirname(dest), { recursive: true });
  const res = await get(url, "*/*");
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const { rename } = await import("node:fs/promises");
  await rename(tmp, dest);
  return (await stat(dest)).size;
}

// ---------------------------------------------------------------- extract

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
  });
}

async function extractZip(zip, into) {
  await mkdir(into, { recursive: true });
  if (process.platform === "win32") {
    // bsdtar ships with Windows 10+ and handles zip; PowerShell is the fallback.
    try {
      return await run("tar", ["-xf", zip, "-C", into]);
    } catch {
      return await run("powershell", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${into}' -Force`,
      ]);
    }
  }
  try {
    return await run("unzip", ["-qo", zip, "-d", into]);
  } catch {
    return await run("tar", ["-xf", zip, "-C", into]);
  }
}

// ---------------------------------------------------------------- lock

async function readLock() {
  try {
    return JSON.parse(await readFile(LOCK, "utf8"));
  } catch {
    return { note: "Generated by pipeline/vendor.mjs — do not edit by hand.", sources: {} };
  }
}

// ---------------------------------------------------------------- reporting

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  bad: (s) => `\x1b[31m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
};

function manualInstructions(row) {
  return [
    `  ${c.warn("manual")} ${c.b(row.id)}`,
    `     1. open ${row.page}`,
    `     2. download the free (CC0) tier`,
    `     3. save it as ${join("pipeline", "vendor", "_drop", row.expect)}`,
    `     4. re-run this script to hash and lock it`,
  ].join("\n");
}

// ---------------------------------------------------------------- main

async function main() {
  const { flags, only } = parseArgs(process.argv.slice(2));
  let rows = await readLedger();
  if (only) {
    const known = new Set(rows.map((r) => r.id));
    const bad = only.filter((id) => !known.has(id));
    if (bad.length) throw new Error(`unknown id(s): ${bad.join(", ")}`);
    rows = rows.filter((r) => only.includes(r.id));
  }

  if (flags.has("list")) {
    console.log(`\n${c.b("art-recipes/sources.jsonl")} — ${rows.length} CC0 sources\n`);
    for (const r of rows) {
      console.log(`  ${c.b(r.id.padEnd(38))} ${r.class.padEnd(17)} ${r.licence}  ${c.dim(r.resolver)}`);
      console.log(`  ${c.dim(r.covers)}\n`);
    }
    return 0;
  }

  const lock = await readLock();

  if (flags.has("check")) {
    let bad = 0;
    for (const r of rows) {
      const entry = lock.sources[r.id];
      if (!entry) {
        console.log(`  ${c.warn("unlocked")} ${r.id} — never fetched`);
        bad++;
        continue;
      }
      for (const f of entry.files) {
        const path = join(ROOT, f.path);
        if (!(await exists(path))) {
          console.log(`  ${c.bad("missing ")} ${r.id} — ${f.path}`);
          bad++;
        } else if ((await sha256File(path)) !== f.sha256) {
          console.log(`  ${c.bad("modified")} ${r.id} — ${f.path} does not match the lock`);
          bad++;
        } else {
          console.log(`  ${c.ok("ok      ")} ${r.id} — ${f.path}`);
        }
      }
    }
    console.log(bad ? `\n${c.bad(`${bad} problem(s)`)}\n` : `\n${c.ok("all vendored sources match the lock")}\n`);
    return bad ? 1 : 0;
  }

  await mkdir(DROP, { recursive: true });
  console.log(`\n${c.b("Vendoring CC0 sources")} → pipeline/vendor/\n`);

  let fetched = 0;
  let skipped = 0;
  let pendingManual = 0;
  const failures = [];

  for (const row of rows) {
    const resolver = resolvers[row.resolver];
    if (!resolver) {
      failures.push([row.id, `unknown resolver "${row.resolver}"`]);
      continue;
    }
    const dir = join(OUT, row.id);

    try {
      if (row.resolver === "manual") {
        const dropped = join(DROP, row.expect);
        if (!(await exists(dropped))) {
          console.log(manualInstructions(row));
          pendingManual++;
          continue;
        }
        const sha256 = await sha256File(dropped);
        const size = (await stat(dropped)).size;
        lock.sources[row.id] = {
          licence: row.licence,
          author: row.author,
          page: row.page,
          resolver: row.resolver,
          licenceEvidence: "manual drop; licence asserted from ledger",
          fetchedAt: new Date().toISOString(),
          files: [{ path: `pipeline/vendor/_drop/${row.expect}`, sha256, bytes: size }],
        };
        console.log(`  ${c.ok("locked  ")} ${c.b(row.id)} ${c.dim(`${(size / 1e6).toFixed(1)} MB (manual drop)`)}`);
        fetched++;
        continue;
      }

      const plan = await resolver(row);
      const files = [];
      let anyNew = false;

      for (const f of plan.files) {
        const dest = join(dir, f.name);
        const rel = `pipeline/vendor/${row.id}/${f.name}`;
        if ((await exists(dest)) && !flags.has("force")) {
          files.push({ path: rel, sha256: await sha256File(dest), bytes: (await stat(dest)).size });
        } else {
          const bytes = await download(f.url, dest);
          anyNew = true;
          if (f.md5) {
            const got = await md5File(dest);
            if (got !== f.md5) throw new Error(`md5 mismatch for ${f.name}: ${got} != ${f.md5}`);
          }
          files.push({ path: rel, sha256: await sha256File(dest), bytes, url: f.url });
        }

        /* Extraction is keyed off the flag and the absence of the output dir,
         * not off whether we just downloaded — otherwise `--extract` on an
         * already-vendored pack silently does nothing. */
        if (flags.has("extract") && dest.endsWith(".zip")) {
          const into = join(dir, "extracted");
          if (flags.has("force") || !(await exists(into))) await extractZip(dest, into);
        }
      }

      lock.sources[row.id] = {
        licence: row.licence,
        author: row.author,
        page: row.page,
        resolver: row.resolver,
        licenceEvidence: plan.licenceEvidence,
        fetchedAt: new Date().toISOString(),
        files,
      };

      const mb = files.reduce((n, f) => n + f.bytes, 0) / 1e6;
      if (anyNew) {
        console.log(`  ${c.ok("fetched ")} ${c.b(row.id)} ${c.dim(`${mb.toFixed(1)} MB`)}`);
        fetched++;
      } else {
        console.log(`  ${c.dim("present ")} ${row.id} ${c.dim(`${mb.toFixed(1)} MB`)}`);
        skipped++;
      }
    } catch (e) {
      console.log(`  ${c.bad("failed  ")} ${c.b(row.id)} — ${e.message}`);
      failures.push([row.id, e.message]);
    }
  }

  await writeFile(LOCK, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  console.log(
    `\n${c.b("Summary")}  ${fetched} fetched · ${skipped} already present · ` +
      `${pendingManual} awaiting manual drop · ${failures.length} failed`,
  );
  console.log(c.dim(`Lockfile: art-recipes/sources.lock.json`));
  if (pendingManual) {
    console.log(
      c.dim(`\nManual sources are gated behind JS download buttons — that is the publisher's\n` +
        `choice, not a gap in this script. Drop the files and re-run to lock them.`),
    );
  }
  console.log();
  return failures.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`\n${c.bad("vendor.mjs failed")} — ${e.message}\n`);
    process.exit(1);
  },
);
