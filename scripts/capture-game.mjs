/*
 * scripts/capture-game.mjs — drive the built game and screenshot it.
 *
 * The smoke test proves the game boots; this proves the game *plays*. It takes
 * pointer lock with a trusted click, arms hotbar slots, places traps, and can
 * start a round — so the screenshot shows the HUD, the hotbar and real trap
 * geometry rather than the title card.
 *
 * This is the seed of the attract-mode capture in GALLOWS_HYMN.md §19.2: once
 * replays land at M1, the same harness plays a recorded run past a cinematic
 * camera instead of a scripted one.
 *
 *   node scripts/capture-game.mjs [--out shot.png] [--round] [--chrome <path>]
 */

import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { extname, join, normalize, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "build");
/* A crashed earlier run can leave its server bound, so walk up from the base
   port rather than dying on EADDRINUSE. */
const BASE_PORT = 4174;
let PORT = BASE_PORT;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const OUT = resolve(arg("out", join(ROOT, "capture-game.png")));

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

const server = await listen(
  async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    try {
      const body = await readFile(join(ROOT, normalize(p)));
      res.writeHead(200, {
        "content-type": MIME[extname(p)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  },
);

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

// A trusted click is what earns pointer lock — synthetic dispatch would not.
await page.click(".gh-play");
await page.waitForFunction(() => document.pointerLockElement !== null, {
  timeout: 15000,
});

/** SwiftShader runs at a few fps, so every wait here is generous on purpose. */
const beat = (ms = 900) => new Promise((r) => setTimeout(r, ms));

/*
 * Two modes.
 *
 * `--upgrade` places ONE trap and never touches the mouse again, so the crosshair
 * is guaranteed to still be on that cell and the upgrade panel (§6) must appear.
 * Under pointer lock the mouse reports only deltas, so "look back at the thing I
 * placed" is not a coordinate you can compute from outside the page — not moving
 * at all is the only reliable way to stay on it.
 *
 * Otherwise it builds the Tar + Vent pair, which is the combo worth showing.
 */
const upgradeMode = argv.includes("--upgrade");

// The player spawns facing the gate with a slight downward pitch, so the
// crosshair already meets the floor ~18m down the lane.
await page.keyboard.press("Digit3"); // Tar Seep — slot 1 is the gun now (§7 decision 17)
await beat();
await page.mouse.click(800, 450);
await beat(1200);

if (upgradeMode) {
  /*
   * Aim back onto the trap we just placed, by closed loop.
   *
   * Under pointer lock the mouse reports only deltas, and headless Chrome's
   * synthetic moves do not map cleanly onto view rotation — the aim drifts a
   * few metres between placing and checking. So rather than guess a coordinate,
   * read the crosshair's grid cell and the trap's cell out of the debug hook and
   * nudge the pitch until they agree. Terminates or reports honestly.
   */
  let panel = null;
  let last = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const st = await page.evaluate(() => window.__gallowsHymn ?? null);
    last = st;
    if (st && st.trapAt >= 0) {
      panel = await page.evaluate(() => {
        const el = document.querySelector(".gh-upgrade");
        return el ? el.textContent.replace(/\s+/g, " ").trim() : null;
      });
      if (panel) break;
    }
    // aimCell < trapCell ⇒ the crosshair is too close ⇒ raise the aim.
    const dy = st && st.aimCell < st.trapCell0 ? -3 : 3;
    await page.mouse.move(800, 450 + dy * (attempt + 1));
    await beat(260);
  }
  console.log("aim loop ended:", JSON.stringify(last));
  if (!panel) console.error("WARNING: the upgrade panel never appeared");
  else console.log("upgrade panel:", panel);
  await beat(500);
} else {
  // Nudge the aim and drop a Brimstone Vent beside the tar so the pool lights.
  await page.mouse.move(830, 470);
  await page.keyboard.press("Digit4"); // Brimstone Vent
  await beat();
  await page.mouse.click(830, 470);
  await beat();
  await page.keyboard.press("Digit6"); // Sigil of Nine — the biggest reach ring
  await beat(1400);
}

if (argv.includes("--round")) {
  await page.keyboard.press("KeyF");
  await beat(6000);
}

const state = await page.evaluate(() => window.__gallowsHymn ?? null);
await page.screenshot({ path: OUT });

console.log(JSON.stringify({ state, errors, screenshot: OUT }, null, 2));

await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
