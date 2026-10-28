// Post-build: give each home-screen app its own copy of build/index.html
// with its manifest, touch icon, theme colour and title already in place;
// vercel.json rewrites the app's routes to that file.
//
// Why: Chrome decides what "Install app" installs from the manifest in the
// HTML it first receives. With only the SPA swap (AppIdentity), /bowler
// arrives pointing at the portfolio's manifest.json and switches once the
// JS has loaded, so the install menu can be looking at the wrong app.
//
// Each app's name and colour come from its own .webmanifest, so there's one
// source of truth. Every replacement must hit exactly once or the build
// fails, rather than quietly shipping a shell with the wrong identity.
//
//   node scripts/app-shells.mjs [buildDir]
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Keep in sync with APP_SCOPES in src/Components/AppIdentity/install.js and
// the rewrites in vercel.json.
export const APPS = ["bowler", "dashboard", "acta", "budgetter", "garage"];

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function replaceOnce(html, pattern, replacement, what) {
  const hits = html.match(new RegExp(pattern.source, "g")) || [];
  if (hits.length !== 1) throw new Error(`app-shells: expected one ${what}, found ${hits.length}`);
  return html.replace(pattern, replacement);
}

/** index.html re-pointed at one app's manifest, icon, colour and title. */
export function shellFor(html, { slug, title, themeColor }) {
  let out = html;
  out = replaceOnce(out, /(<link rel="manifest" href=")[^"]*(")/, `$1/${slug}.webmanifest$2`, "manifest link");
  out = replaceOnce(out, /(<link rel="apple-touch-icon" href=")[^"]*(")/, `$1/${slug}-icon-180.png$2`, "touch icon");
  out = replaceOnce(out, /(<meta name="theme-color" content=")[^"]*(")/, `$1${themeColor}$2`, "theme colour");
  out = replaceOnce(out, /<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`, "title");
  return out;
}

export function buildShells(buildDir = join(ROOT, "build")) {
  const html = readFileSync(join(buildDir, "index.html"), "utf8");
  return APPS.map((slug) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "public", `${slug}.webmanifest`), "utf8"));
    const file = join(buildDir, `${slug}.html`);
    writeFileSync(file, shellFor(html, { slug, title: manifest.name, themeColor: manifest.theme_color }));
    return file;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = buildShells(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`app-shells: wrote ${files.length} app shells`);
}
