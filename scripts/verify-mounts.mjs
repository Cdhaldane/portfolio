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
/*
 * Anchor every later move at the button we clicked.
 *
 * Puppeteer reports mouse moves as DELTAS from its own last position, and the trusted
 * click that earns pointer lock leaves the cursor on the play button. Moving to any
 * other coordinate afterwards is therefore one enormous delta that spins the camera
 * off the map — which is why, for three attempts, only the very first sample of a
 * sweep ever resolved and every one after it read -1. Panning from the anchor keeps
 * every delta small and deliberate.
 */
const anchor = await page.$eval(".gh-play", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
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
/* Boot Hill derives a couple of hundred wall tiles now — walls are a lattice, not a
   list of authored mounts, so this checks for "generous" rather than a magic number. */
if (st.mountSlots < 50) {
  fail.push(`arming a wall trap offers only ${st.mountSlots} wall tiles`);
}
// The lattice is the visible half of the feature: no marks, no way to know where.
if (st.marks < 50) {
  fail.push(`${st.marks} wall tiles drawn against ${st.mountSlots} buildable`);
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
/* `canPlace`, not just "aimed at something". The spawn looks straight at Boot Hill's
   crypt row, which is authored NO-BUILD — so the first thing the crosshair finds is a
   face the game is right to refuse, and a harness that only checked "did I hit a wall
   tile" would call that a bug. */
let found = st.canPlace ? st.aimCell : -1;
if (found >= 0) {
  note.push(`already aimed at a buildable face from the spawn (aimCell ${found})`);
}
/* Deltas have to ACCUMULATE. The first version nudged right, down, left, up — four
   moves summing to zero — so it hovered over the same square metre of crypt for
   thirty samples and reported that no buildable face existed anywhere. Panning in one
   direction sweeps the room. */
/* Pitch has to descend MONOTONICALLY as well as pan.
   Puppeteer's first move is a delta from wherever the trusted play-button click left
   the cursor — near the bottom of the screen — so moving to y=450 throws the camera at
   the sky, and a pitch pattern that nets to zero leaves it there. Walking y downward
   recovers from that no matter where the click left us. */
/* Walk in first.
   The crosshair rests ~8 degrees down (§7), so at range it passes UNDER a 4m wall —
   from the spawn only the crypt row is close enough to be hit at all, and the crypt
   row is exactly the face this map refuses. Closing the distance is what puts an
   ordinary buildable wall under the crosshair, and it is also what a player does. */
await page.keyboard.down("KeyA");
await beat(2200);
await page.keyboard.up("KeyA");
await beat(400);

let panX = anchor.x;
for (let i = 0; found < 0 && i < 24; i++) {
  panX += 40;
  await page.mouse.move(panX, anchor.y - Math.floor(i / 6) * 30);
  await beat(300);
  st = await read();
  if (i < 10) note.push(`  pan ${i}: aimCell=${st && st.aimCell} canPlace=${st && st.canPlace} marks=${st && st.marks}`);
  if (st && st.canPlace) {
    found = st.aimCell;
    note.push(`found a buildable face after panning (aimCell ${found})`);
  }
}
if (found < 0) {
  fail.push("swept the walls and never found a buildable face");
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
      `clicked a buildable face (${found}) and no mounted trap appeared`,
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
