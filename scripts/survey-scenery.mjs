/*
 * scripts/survey-scenery.mjs — look at the world, from several angles.
 *
 * The capture harness exists to prove a *feature* works, so it aims wherever the
 * feature lives and leaves the camera there. Judging scenery needs the opposite:
 * a few deliberate vantage points, no HUD in the way, and the same framing every
 * time so two runs can be compared.
 *
 *   node scripts/survey-scenery.mjs [--out build/survey] [--hud] [--chrome <path>]
 *
 * Writes one PNG per shot. Under pointer lock the mouse reports deltas only, so
 * every angle here is expressed as a delta from the spawn pose and the order
 * matters — the shots walk the camera round rather than teleporting it.
 */

import { spawn } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const OUT = flag("out", "build/survey");
const SHOW_HUD = argv.includes("--hud");
const PORT = 4599;

async function findChrome() {
  const explicit = flag("chrome", null);
  if (explicit) return explicit;
  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      await access(c);
      return c;
    } catch {
      /* next */
    }
  }
  throw new Error("no Chrome found — pass --chrome <path>");
}

const server = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"],
  { cwd: "game", stdio: "ignore", shell: false },
);
const stop = () => server.kill();
process.on("exit", stop);

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

const beat = (ms = 1100) => new Promise((r) => setTimeout(r, ms));

// The HUD is not the subject. Hidden by default so the frame is all world.
if (!SHOW_HUD) {
  await page.addStyleTag({
    content: ".gh-hotbar,.gh-panel,.gh-round,.gh-tally,.gh-crosshair,.gh-abilities{display:none!important}",
  });
}

await mkdir(OUT, { recursive: true });

/**
 * Absolute yaw/pitch, set through `__ghLook` (host/loop.ts).
 *
 * Mouse deltas are unusable here: puppeteer's `mouse.move` is absolute, so a
 * run of small steps cancels itself out and the camera barely turns. Yaw 0
 * looks down −z; pitch is negative to look down.
 */
const SHOTS = [
  { name: "01-lane", yaw: 0, pitch: -0.22, note: "down the lane the player faces at spawn" },
  { name: "02-ground", yaw: 0, pitch: -0.75, note: "the floor — dressing density and tiling" },
  { name: "03-horizon", yaw: 0, pitch: -0.02, note: "silhouette against the sky" },
  { name: "04-right", yaw: Math.PI / 2, pitch: -0.22, note: "the fence line, middle distance" },
  { name: "05-back", yaw: Math.PI, pitch: -0.22, note: "behind spawn — the Rift side" },
  { name: "06-left", yaw: -Math.PI / 2, pitch: -0.22, note: "completing the turn" },
];

const shots = [];
for (const shot of SHOTS) {
  await page.evaluate(
    (y, p) => window.__ghLook?.(y, p),
    shot.yaw,
    shot.pitch,
  );
  await beat();
  const path = join(OUT, `${shot.name}.png`);
  await page.screenshot({ path });
  shots.push({ ...shot, path });
}

console.log(JSON.stringify({ shots: shots.map((s) => s.path), errors }, null, 2));

await browser.close();
stop();
