#!/usr/bin/env node
// Regenerate the social-share card at public/og-image.png from og.html.
// Needs a Chrome/Chromium binary; no network (fonts come from ../resume/fonts.css).
//
//   node og/build.mjs
//
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "og.html");
const out = resolve(here, "..", "public", "og-image.png");

const CHROME_CANDIDATES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "chrome",
];

function findChrome() {
  for (const bin of CHROME_CANDIDATES) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome/Chromium found. Install one of: " + CHROME_CANDIDATES.join(", "));
  process.exit(1);
}

const tmp = join(mkdtempSync(join(tmpdir(), "og-")), "og.png");
console.log(`Rendering with ${chrome} …`);
execFileSync(
  chrome,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--window-size=1200,630",
    `--screenshot=${tmp}`,
    `file://${src}`,
  ],
  { stdio: "inherit" }
);
copyFileSync(tmp, out);
console.log(`Wrote ${out} (1200x630). Commit it to deploy.`);
