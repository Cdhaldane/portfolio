#!/usr/bin/env node
// Regenerate the résumé PDF from resume.html and drop it into public/ (and
// build/ if present). Fonts + headshot are already embedded/local, so this
// needs no network — only a Chrome/Chromium binary to print to PDF.
//
//   node resume/build.mjs
//
import { execFileSync } from "node:child_process";
import { existsSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "resume.html");
const root = resolve(here, "..");
const targets = [
  join(root, "public", "CHARLIE_RESUME_5.pdf"),
  join(root, "build", "CHARLIE_RESUME_5.pdf"), // local build output (gitignored)
];

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
      /* try the next candidate */
    }
  }
  return null;
}

const chrome = findChrome();
if (!chrome) {
  console.error(
    "No Chrome/Chromium found. Install one of: " + CHROME_CANDIDATES.join(", ")
  );
  process.exit(1);
}

const outPdf = join(mkdtempSync(join(tmpdir(), "resume-")), "resume.pdf");
console.log(`Rendering with ${chrome} …`);
execFileSync(
  chrome,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--virtual-time-budget=4000",
    `--print-to-pdf=${outPdf}`,
    `file://${src}`,
  ],
  { stdio: "inherit" }
);

let wrote = 0;
for (const t of targets) {
  if (t.includes("/build/") && !existsSync(dirname(t))) continue; // no local build yet
  copyFileSync(outPdf, t);
  console.log(`  → ${t}`);
  wrote++;
}
console.log(`Done. Updated ${wrote} file(s). Commit public/CHARLIE_RESUME_5.pdf to deploy.`);
