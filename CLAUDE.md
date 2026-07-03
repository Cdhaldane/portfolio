# Design Philosophy — Charlie Haldane Portfolio

> The portfolio is the product. Every page should *demonstrate* craft, not just
> describe it. If a visitor can feel the attention to motion, layout, and detail
> within five seconds, the page is doing its job.

The About page ([src/Pages/About/](src/Pages/About/)) is the reference
implementation of this philosophy. New work should match its bar.

---

## 1. Principles

1. **Show, don't tell.** Claims about skill ("I sweat the details") must be
   backed by the interface proving it. Motion, layout, and interaction are the
   portfolio, not decoration on top of it.
2. **Motion with intent.** Every animation earns its place — it guides
   attention, reinforces hierarchy, or rewards interaction. No motion for its
   own sake. Default easing is expressive but quick (`cubic-bezier(0.16, 1, 0.3, 1)`).
3. **Editorial layout.** Big type, generous negative space, asymmetric grids,
   numbered sections (`01 / 02 / 03`). Confident, magazine-like composition over
   centered-everything safety.
4. **Depth through layering.** Aurora gradients, glassmorphism, soft shadows,
   and subtle 3D (perspective tilt) create a sense of physical space.
5. **Performance is part of the craft.** Animate `transform`/`opacity`, never
   layout properties. Scroll-linked effects write a single CSS variable, not per-
   frame React state. 60fps is non-negotiable.
6. **Inclusive by default.** Everything degrades gracefully under
   `prefers-reduced-motion`. Interactive elements keep accessible labels.

---

## 2. Design tokens

Scoped locally on `.ab` today; promote to `:root` when rolling out site-wide.

| Token        | Value       | Role                          |
| ------------ | ----------- | ----------------------------- |
| `--ink`      | `#1a1a17`   | Primary text / dark surfaces  |
| `--ink-soft` | `#4a4a44`   | Secondary text                |
| `--paper`    | `#eef2e9`   | Page background               |
| `--paper-2`  | `#e3e9da`   | Alt surface                   |
| `--card`     | `rgba(255,255,255,.55)` | Glass surfaces    |
| `--line`     | `rgba(26,26,23,.12)`    | Hairlines / tracks |
| `--blue`     | `#2f6bff`   | Primary accent / interaction  |
| `--blue-deep`| `#1741c9`   | Accent gradient end           |
| `--sage`     | `#6f9a5e`   | Secondary accent (brand root) |
| `--accent`   | `#ff5d3b`   | Energy / highlight pops       |

The `blue → sage → coral` gradient is the signature — use it for progress fills,
glows, and key highlights.

### Type
- **Space Grotesk** — display & UI (headings, buttons, labels)
- **Inter** — body copy (longer reading passages)
- **IBM Plex Mono** — metadata, numbers, indices, timestamps

---

## 3. Motion system

| Pattern              | Where                         | How |
| -------------------- | ----------------------------- | --- |
| Scroll-reveal        | Sections, paragraphs, stats   | `IntersectionObserver` adds `.is-in`; CSS transitions opacity/translate/blur |
| Kinetic type         | Hero name                     | Per-letter staggered `@keyframes`, individually hoverable |
| Scroll progress      | Left rail spine, ring, top bar | One `--progress` CSS var (0→1) drives `scaleY`, `conic-gradient`, `scaleX` |
| 3D tilt              | Portrait card                 | Pointer position → `--rx`/`--ry` rotation in `perspective` |
| Cursor spotlight     | Hero                          | Pointer position → `--mx`/`--my` radial gradient |
| Spring physics       | Skill cards                   | framer-motion `whileInView` stagger + `whileHover` spring |
| Ambient drift        | Aurora blobs, portrait float  | Slow infinite `@keyframes` |
| Smooth scroll        | Whole page                    | Lenis inertial scrolling |

**Rule of thumb:** scroll-*linked* effects (progress) use a CSS variable updated
in a rAF-throttled listener. Scroll-*triggered* effects (one-shot reveals) use
`IntersectionObserver` or framer-motion `whileInView` with `once: true`.

---

## 4. Libraries

- **framer-motion** — declarative entrance/exit, stagger, and spring physics.
  Reach for it when state-driven or physics-based motion is clearer than CSS.
- **lenis** — site-feel smooth scrolling; makes all scroll-linked motion read as
  intentional. Always gate behind `prefers-reduced-motion` and clean up the rAF
  loop / instance on unmount.

Prefer plain CSS for simple, declarative, always-on animation (cheaper, no JS).
Reach for a library when the animation is interactive, physics-based, or
orchestrated.

---

## 5. Implementation conventions

- **Self-contained pages.** Page styles are namespaced (`.ab-*`) so a redesign
  never leaks. When a page needs to replace a global element (e.g. the sidebar),
  hide the global one for that route and ship a bespoke version.
- **CSS variables for anything JS animates** — never set `style.transform`
  imperatively in a scroll loop; set a variable and let CSS read it.
- **Throttle scroll/pointer handlers** with `requestAnimationFrame`; register
  listeners `{ passive: true }`; always clean up in the effect's return.
- **Always provide a reduced-motion path.** A `@media (prefers-reduced-motion)`
  block should flatten animations, and JS effects should early-return when the
  query matches.
- **Responsive:** rail/heavy chrome collapses below 768px; the top progress bar
  is the mobile fallback for the scroll spine.

---

## 6. Roadmap

**Done**

- ✅ Token set + type system rolled out across Landing, Work, Contact, and
  Services — every page shares the palette, Space Grotesk/Inter/mono, and
  dark-mode (`data-theme`) tokens.
- ✅ Reusable `<Reveal>` (IntersectionObserver entrance) and `<ScrollProgress>`
  (rAF-throttled `--progress` bar) live in `src/Components/`.

**Next**

- Promote the per-page token blocks to a single `:root` set — they're currently
  redeclared per page (`.lp`, `.wk`, `.nf`, `.gb`, `.wr`…). One source of truth
  would DRY it up (the shared components already read `--blue`/`--sage`/etc.).
- Consider promoting Lenis to the app root once nested scroll containers
  (e.g. the Work list) are reconciled with `data-lenis-prevent`.
- Per-*route* social previews: OG tags are static in `index.html` (crawler-safe)
  with a branded `og-image.png`. True per-page cards need prerendering
  (react-snap) or SSR, since crawlers don't execute the client-side Helmet tags.
