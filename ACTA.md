# Acta Diurna (`/acta`)

One history lesson a day, about 15 minutes, read on a phone as a feed of
~27 cards that ends. Public. Claude proposes each season's topics, Charlie
approves them, and Claude writes and fact-checks every lesson from Wikipedia
and verified primary sources before it goes live.

Concept and decisions: https://claude.ai/artifact/NhSxM7BkjJmkjwFLL2c96a

## Map

| Piece | Where |
| --- | --- |
| Page (feed, archive, timeline, review, saved, desk) | `src/Pages/Acta/` |
| Era skins (palette + display face per era) | `src/Pages/Acta/eras.js` |
| Reader state (progress, review deck, saves, votes) | `src/Pages/Acta/store.js` (localStorage; synced for Charlie by `owner.jsx`) |
| Bundled sample / seed lesson | `src/Pages/Acta/lessons/salamis.json` |
| One serverless function, all routes | `api/acta/[action].js` → `api/_lib/acta-handler.js` |
| Pipeline state machine, seasons, scheduling | `api/_lib/acta-pipeline.js`, `acta-schedule.js` |
| Lesson format, normaliser, verbatim-quote check | `api/_lib/acta-lesson.js` |
| Wikipedia / Commons / primary-source fetching | `api/_lib/acta-sources.js` |
| Tappable people and places (Wikipedia summary sheet) | `src/Pages/Acta/mentions.jsx`; matching in `lessonUtil.js` |
| Resolve a hand-written lesson's mentions | `node scripts/acta-mentions.js <lesson.json …>` |
| Prompts and Claude calls (Opus 5.5) | `api/_lib/acta-claude.js` |
| Tables (`acta_*`, same Neon DB) | `api/_lib/acta-db.js` |
| Season 1 + seed lessons | `api/_lib/acta-seed.js` |
| Daily reminder push | `api/_lib/acta-push.js`, `public/acta-sw.js` |
| Terminal | `npm run acta -- status / propose / approve <id> / advance [--loop]` |

## A lesson's life

```
queued → gathered → researching → researched → writing → written → checking → ready
                                                    ↑                     │
                                                    └──── revising ←──────┘ (errors, up to 2 rewrites)
                                                       needs_review ← still wrong: Charlie decides
```

- **gather**: Wikipedia plain text + media list for the topic's 1–3 articles.
- **research** (batch): Claude searches only public-domain primary-source
  sites (Perseus, LacusCurtius, Wikisource, Gutenberg, Fordham, Avalon…).
  The server then fetches each cited page itself and keeps an excerpt only
  if it appears **word for word**. Failure here is fine: the lesson is
  written without quotes.
- **write** (batch): structured JSON in the card grammar. `normalizeLesson`
  clamps it and flags format errors; a quote not found verbatim in the
  sources is an error.
- **check** (batch): a separate fact-checking pass against the same sources.
  Errors (plus format errors) go back for a rewrite.
- **ready**: Commons image URLs and credits resolved once and stored (visitors
  never hit the Commons API; non-Commons, i.e. non-free, files are dropped).
  The same pass resolves `mentions`: the writer lists the people and places
  the cards name (`{ wiki, kind, names }`), and each gets Wikipedia's REST
  summary, description, URL and Commons lead image with credit. Missing
  articles, disambiguation pages and the topic's own articles are dropped.
  Live on its `publish_on` date unless held.

Every Claude step is a Message Batch submitted on one pass and collected on a
later one, so no request waits on a model (Vercel's limit is 300 s). Passes
run from the daily cron (11:00 UTC), the desk's "Run the pipeline now" (or
"keep running"), or `npm run acta -- advance --loop`. A lock in `acta_meta`
stops passes overlapping; transitions are conditional on the status they
started from.

## Calendar

- Mon person · Tue place · Wed moment · Thu idea · Fri object · Sat
  meanwhile (same years, elsewhere) · **Sun review, no lesson**.
- A season is 5 weeks = 30 topics, scheduled from the next Monday at least
  two days out (or after the last scheduled lesson). Day numbers follow the
  calendar.
- Generation starts 10 days ahead (`LEAD_DAYS`). The cron proposes the next
  season when fewer than 14 lessons remain and none is waiting.
- "Today" is Toronto time (`ACTA_TZ`).

## Setup (Vercel env)

| Var | Needed for |
| --- | --- |
| `POSTGRES_URL` | everything (already set) |
| `ANTHROPIC_API_KEY` | writing lessons, proposing seasons, Ask |
| `CRON_SECRET` | the daily cron (already set for Budgetter) |
| `ACTA_EDITOR_USER_IDS` | the desk and Ask (fail-closed) |
| `REACT_APP_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | desk sign-in (already set) |
| `ACTA_VAPID_PUBLIC_KEY`, `ACTA_VAPID_PRIVATE_KEY`, `ACTA_VAPID_SUBJECT` | optional daily reminders (`npx web-push generate-vapid-keys`) |

First run: deploy, open `/acta/desk`, sign in, copy the user id it shows into
`ACTA_EDITOR_USER_IDS`, redeploy, approve Season 1. Until the first lesson
goes live, `/acta` shows the bundled Salamis lesson as a sample.

## Rules worth keeping

- **Quotes are verbatim or they don't ship.** Don't loosen `containsVerbatim`
  to make a lesson pass; fix the lesson.
- Hand-written seed lessons go through `normalizeLesson` too (see
  `acta-lesson.test.js`), and their images are resolved with `resolveImages`.
  They skip `finish()`, so run `scripts/acta-mentions.js` on them after any
  edit and read its list: it's the only check that each name landed on the
  right article and not a namesake.
- A mention links only where a name occurs as a whole word in prose (card
  text, quote notes, debate sides; never titles, quotes or questions), and
  only the first time per card. Names are case-sensitive and exact.
- Visitors never load Clerk: owner mode is lazy and only on devices where the
  desk has been opened (`localStorage["acta:owner"]`).
- The feed is a native scroll-snap container; Lenis is off for `/acta`
  (`SmoothScroll` `SKIP_PREFIXES`). Sidebar and theme switch are hidden too.
- Tests: `npm run test:api` (pipeline, handler, sources, lesson, schedule,
  push, prompts) and `npx react-app-rewired test --watchAll=false src/Pages/Acta`.
