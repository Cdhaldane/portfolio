/*
 * scripts/smoke-game.mjs — browser smoke test for the built game.
 *
 * GALLOWS_HYMN.md §19.1 lists this as one of the M0 test layers: boot the built
 * app in a real browser, assert no console errors, capture a screenshot. It
 * checks exactly the things the headless sim tests cannot — that WebGL2
 * initialises, the shader warm-up resolves, and the frame loop advances.
 *
 *   node scripts/smoke-game.mjs [--out shot.png] [--chrome <path>] [--keep]
 *
 * Requires a prior `npm run build`. Uses puppeteer-core against an installed
 * Chrome/Edge (we don't ship a browser download).
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
const BASE_PORT = 4173;
let PORT = BASE_PORT;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const OUT = resolve(arg("out", join(HERE, "..", "build", "smoke-game.png")));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  arg("chrome", null),
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

async function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    try {
      await access(c);
      return c;
    } catch {
      /* keep looking */
    }
  }
  throw new Error(
    `No Chrome/Edge found. Pass --chrome <path> or set CHROME_PATH.\nTried:\n  ${CHROME_CANDIDATES.join("\n  ")}`,
  );
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".xml": "application/xml",
};

function serve() {
  const handler = async (req, res) => {
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
  };
  return (async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      PORT = BASE_PORT + attempt;
      const server = createServer(handler);
      const ok = await new Promise((done) => {
        server.once("error", () => done(false));
        server.listen(PORT, () => done(true));
      });
      if (ok) return server;
    }
    throw new Error("no free port");
  })();
}

const chrome = await findChrome();
const server = await serve();

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: !argv.includes("--keep"),
  args: [
    "--window-size=1600,900",
    // Headless Chrome has no GPU: force the software rasteriser so WebGL2 works.
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });

const errors = [];
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !/favicon/.test(t)) errors.push(t);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => {
  if (!/favicon/.test(r.url())) errors.push(`requestfailed: ${r.url()}`);
});

await page.goto(`http://localhost:${PORT}/hymn/`, {
  waitUntil: "networkidle0",
  timeout: 60000,
});

// The play button only enables once warmUp() (compileAsync) has resolved, so
// waiting on it proves every shader compiled without throwing.
await page.waitForFunction(
  () => {
    const b = document.querySelector(".gh-play");
    return b && !b.disabled;
  },
  { timeout: 60000 },
);

const checks = await page.evaluate(async () => {
  const canvas = document.querySelector("canvas.gh-canvas");
  const gl = canvas?.getContext("webgl2");
  const before = { ...(window.__gallowsHymn ?? {}) };
  await new Promise((r) => setTimeout(r, 1200));
  const after = { ...(window.__gallowsHymn ?? {}) };
  return {
    hasCanvas: Boolean(canvas),
    canvasSize: canvas ? `${canvas.width}x${canvas.height}` : null,
    webgl2: Boolean(gl),
    glVersion: gl ? gl.getParameter(gl.VERSION) : null,
    title: document.querySelector(".gh-title")?.textContent ?? null,
    framesAdvanced: (after.frame ?? 0) - (before.frame ?? 0),
    ticksAdvanced: (after.tick ?? 0) - (before.tick ?? 0),
    drawCalls: after.drawCalls ?? 0,
    triangles: after.triangles ?? 0,
  };
});

// The loop runs behind the title card regardless of pointer lock (which headless
// Chrome will not grant), so hiding the overlay reveals the live scene.
await page.evaluate(() => {
  const o = document.querySelector(".gh-overlay");
  if (o) o.style.display = "none";
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: OUT });

const failures = [];
if (!checks.hasCanvas) failures.push("no canvas");
if (!checks.webgl2) failures.push("no WebGL2 context");
// Frame *count*, not frame *rate*: headless Chrome renders through SwiftShader on
// the CPU, so its fps says nothing about real performance. What matters here is
// that the loop advances and the renderer submits work.
if (checks.framesAdvanced < 2) {
  failures.push(`frame loop stalled (${checks.framesAdvanced} frames in 1.2s)`);
}
// Ticks are bounded BY frames here, not by wall time: at SwiftShader's ~3fps the
// accumulator hits MAX_CATCHUP_STEPS every frame and deliberately drops the
// remainder rather than falling further behind (§12.3). So assert the invariant
// that actually matters — the sim advances, and the catch-up ceiling holds.
const MAX_CATCHUP_STEPS = 5;
if (checks.ticksAdvanced < checks.framesAdvanced) {
  failures.push(
    `sim not advancing (${checks.ticksAdvanced} ticks over ${checks.framesAdvanced} frames)`,
  );
}
if (checks.ticksAdvanced > checks.framesAdvanced * MAX_CATCHUP_STEPS) {
  failures.push(
    `catch-up ceiling breached (${checks.ticksAdvanced} ticks over ${checks.framesAdvanced} frames, cap ${MAX_CATCHUP_STEPS}/frame)`,
  );
}
if (checks.drawCalls < 5) failures.push(`suspiciously few draw calls (${checks.drawCalls})`);
if (checks.triangles < 500) failures.push(`suspiciously few triangles (${checks.triangles})`);
if (errors.length) failures.push(...errors);

console.log(JSON.stringify({ chrome, checks, screenshot: OUT }, null, 2));

if (!argv.includes("--keep")) {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error("\nSMOKE FAILED:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("\nSMOKE OK");
process.exit(0);
