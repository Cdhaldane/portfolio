/*
 * scripts/verify-mounts.mjs — prove a wall trap can actually be placed.
 *
 * The headless tests prove the *rules* (a wall trap needs an authored wall mount,
 * a mount takes one trap, a roost only reaches the air). None of them prove the
 * thing that actually decides whether the feature exists: that a player looking at
 * a crypt wall can arm a Scattergun Ports and get it onto the wall.
 *
 * That gap has bitten this project before. In M0.9 the upgrade panel "never
 * appeared" and the bug was entirely in the harness — under pointer lock the mouse
 * reports only deltas, the crosshair had drifted ~3m, and the game was correct the
 * whole time. So mount picking is verified end to end, in a browser, through the
 * same aim path a player uses.
 *
 * What it asserts:
 *   1. arming a wall trap makes the site's wall mounts the aim targets
 *   2. the crosshair snaps to one (aimSlot >= 0) while sweeping the crypt row
 *   3. clicking places it, and the placed trap is off the floor (mounted >= 1)
 *
 *   node scripts/verify-mounts.mjs [--chrome <path>]
 */

import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { extname, join, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "build");
const BASE_PORT = 4188;
let PORT = BASE_PORT;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const CANDIDATES = [
  process.env.CHROME_PATH,
  arg("chrome", null),
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);

async function findChrome() {
  for (const c of CANDIDATES) {
    try {
      await access(c);
      return c;
    } catch {
      /* keep looking */
    }
  }
  throw new Error("No Chrome/Edge found. Pass --chrome <path> or set CHROME_PATH.");
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
};

async function listen(handler) {
  for (let attempt = 0; attempt < 12; attempt++) {
    PORT = BASE_PORT + attempt;
    const s = createServer(handler);
    const ok = await new Promise((done) => {
      s.once("error", () => done(false));
      s.listen(PORT, () => done(true));
    });
    if (ok) return s;
  }
  throw new Error("no free port");
}

const server = await listen(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  try {
    const body = await readFile(join(ROOT, normalize(p)));
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

const browser = await puppeteer.launch({
  executablePath: await findChrome(),
  headless: true,
  args: [
    "--window-size=1600,900",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`http://localhost:${PORT}/hymn/`, { waitUntil: "networkidle0" });
await page.waitForFunction(
  () => {
    const b = document.querySelector(".gh-play");
    return b && !b.disabled;
  },
  { timeout: 60000 },
);
await page.click(".gh-play");
await page.waitForFunction(() => document.pointerLockElement !== null, { timeout: 15000 });

const beat = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const read = () => page.evaluate(() => window.__gallowsHymn ?? null);

const fail = [];
const note = [];

// Key 7 is the Scattergun Ports — the first wall trap (sim/traps.ts).
// Hotbar row 0 is the revolver, so digit N arms trap N-2 (§7 decision 17).
await page.keyboard.press("Digit7");
await beat();

let st = await read();
if (!st) throw new Error("no debug hook — the game did not boot");
note.push(`armed wall trap: buildMode=${st.buildMode} mountSlots=${st.mountSlots}`);
if (st.mountSlots !== 3) {
  fail.push(`arming a wall trap offers ${st.mountSlots} mounts — Boot Hill authors 3`);
}
// The marks are the visible half of the feature: no marks, no way to know where.
if (st.marks !== 3) {
  fail.push(`${st.marks} chalk marks drawn for 3 free mounts`);
}

/*
 * Check the aim BEFORE touching the mouse.
 *
 * The player starts on the plinth facing due east down the lane, and Boot Hill's
 * middle crypt mount is dead ahead — so the honest first question is whether the
 * crosshair is already on it. It is, and an earlier version of this script failed
 * anyway: its first `mouse.move` was a large delta from the play button, which flung
 * the camera off the lane before the first sample was ever read. Under pointer lock
 * every move is relative, so the sweep can only make things worse from a good start.
 *
 * This is the same trap M0.9's upgrade-panel harness fell into. Not moving is the
 * reliable option; the sweep below is the fallback, in small relative nudges.
 */
let found = st.aimSlot >= 0 ? st.aimSlot : -1;
if (found >= 0) {
  note.push(`already aimed at mount ${found} from the spawn (aimCell ${st.aimCell})`);
}
outer: for (let i = 0; found < 0 && i < 8; i++) {
  for (const [dx, dy] of [[40, 0], [0, 25], [-40, 0], [0, -25]]) {
    await page.mouse.move(800 + dx, 450 + dy);
    await beat(320);
    st = await read();
    if (st && st.aimSlot >= 0) {
      found = st.aimSlot;
      note.push(`snapped to mount ${found} after nudging (aimCell ${st.aimCell})`);
      break outer;
    }
  }
}
if (found < 0) {
  fail.push("swept the crypt row and never snapped to a wall mount (aimSlot stayed -1)");
} else {
  // Place it. The click is at wherever the mouse already is, so the aim cannot
  // move between the check and the placement.
  const before = (await read()).mounted;
  await page.mouse.down();
  await page.mouse.up();
  await beat();
  st = await read();
  note.push(`after click: mounted=${st.mounted} (was ${before}) entities=${st.entities}`);
  if (st.mounted <= before) {
    fail.push(
      `clicked on mount ${found} and no mounted trap appeared (mounted stayed ${st.mounted})`,
    );
  }
}

// A floor trap must still resolve to a grid cell, not a mount.
await page.keyboard.press("Digit3");
await beat();
st = await read();
note.push(`floor trap: aimSlot=${st.aimSlot} aimCell=${st.aimCell}`);
if (st.aimSlot >= 0) {
  fail.push(`a floor trap resolved aim to mount ${st.aimSlot} — surface classes crossed`);
}

for (const n of note) console.log("  ·", n);
if (errors.length) {
  console.log("\npage errors:");
  for (const e of errors) console.log("  !", e);
}

await browser.close();
server.close();

if (fail.length || errors.length) {
  console.error("\nFAIL");
  for (const f of fail) console.error("  ✗", f);
  process.exit(1);
}
console.log("\nOK — wall mounts arm, snap and place in a real browser");
