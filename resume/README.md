# Résumé (source)

The résumé served at `public/CHARLIE_RESUME_5.pdf` is generated from the files
here, so it can be re-rendered any time instead of rebuilt from scratch.

It's designed in the portfolio's own design language — Space Grotesk / Inter /
IBM Plex Mono, the paper-and-ink palette, and the `blue → sage → coral`
signature gradient (see [`../CLAUDE.md`](../CLAUDE.md)).

## Files

| File          | What it is                                                             |
| ------------- | ---------------------------------------------------------------------- |
| `resume.html` | The résumé itself — **edit this** (bullets, dates, skills, contact).   |
| `fonts.css`   | The three web fonts, base64-embedded so rendering works offline.       |
| `headshot.jpg`| Square avatar (extracted from the previous PDF, cropped to 320×320).   |
| `build.mjs`   | Renders `resume.html` → PDF and copies it into `public/` (+ `build/`). |

## Edit & regenerate

1. Open `resume.html` and change the content (it's plain HTML — the sections are
   clearly labelled: masthead, contact, profile, experience, skills, education,
   references).
2. Re-render:
   ```bash
   node resume/build.mjs
   ```
   Requires a Chrome/Chromium binary on `PATH` (`google-chrome-stable`,
   `chromium`, …). No network needed — fonts are embedded.
3. Commit the updated `public/CHARLIE_RESUME_5.pdf` (and your `resume.html`
   changes) and push — Vercel redeploys.

## Preview in a browser

Just open `resume/resume.html` directly — it renders as a centered sheet. The
page is print-first (`@page` Letter, no margins), so what you see is what the
PDF becomes.

## Swapping the photo

Replace `headshot.jpg` with any roughly square image (it's shown in a circular
frame). If you only have a wide/tall photo, crop it square first — e.g. with
`sharp`:

```js
require("sharp")("input.jpg").rotate().resize(320, 320, { fit: "cover" })
  .jpeg({ quality: 86 }).toFile("resume/headshot.jpg");
```
