# Social card (OG image)

The link-preview image at `public/og-image.png` is generated from `og.html`,
so it can be re-rendered any time instead of edited by hand.

It's referenced by the static `og:image` / `twitter:image` tags in
`public/index.html` (crawler-visible on every route, since this is a
client-rendered SPA).

## Regenerate

1. Edit `og.html` (name, title, tagline — same design tokens as the site).
2. Render:
   ```bash
   node og/build.mjs
   ```
   Requires a Chrome/Chromium binary on `PATH`. Fonts are pulled from
   `../resume/fonts.css` (base64-embedded), so no network is needed.
3. Commit the updated `public/og-image.png` and push — Vercel redeploys.

The output is 1200×630 (the dimensions declared in `index.html`). If you change
the size, update the `og:image:width` / `og:image:height` meta tags to match.
