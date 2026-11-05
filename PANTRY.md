# Pantry (`/pantry`)

The household kitchen app. Photograph a grocery receipt and Claude turns it
into stock; quick taps keep the count honest; the shopping list builds itself
from what's out, low, or usually due again; Claude suggests recipes from
what's on the shelf, starting with what needs using up. Reminders arrive as
push notifications, and a kitchen display (and a feed Home Assistant can read
aloud) brings it to the Google Home in the kitchen.

Private: Clerk sign-in plus an allowlist, same as Bowler and Garage. Built
2026-11-04.

## Map

| Piece | Where |
| --- | --- |
| Page: Stock / List / Cook / More tabs, item sheet | `src/Pages/Pantry/Pantry.jsx`, `parts/` |
| Receipt flow (photos → Claude → review → save) | `src/Pages/Pantry/parts/ReceiptFlow.jsx`, `image.js` |
| Kitchen display, no sign-in (`/pantry/kitchen?k=…`) | `src/Pages/Pantry/Kitchen.jsx` |
| Sign-in gate + home-screen identity | `src/Pages/Pantry/PantryGate.jsx`, `public/pantry.webmanifest`, `public/pantry-*.png` |
| One serverless function, all routes | `api/pantry.js` |
| Out / low / due / use-soon, the kitchen sentence, the digest | `api/_lib/pantry-stock.js` |
| Validation, receipt planning, Claude-output sanitising | `api/_lib/pantry-normalize.js` |
| Prompts and Claude calls (Haiku 5.5, structured output) | `api/_lib/pantry-claude.js` |
| Tables (`pantry_*`, same Neon DB) | `api/_lib/pantry-db.js` |
| Push (digest + "someone marked it out") | `api/_lib/pantry-push.js`, `public/app-sw.js` |
| Tests | `npm run test:api` (`pantry-*.test.js`), `src/Pages/Pantry/Pantry.smoke.test.jsx` |

## How stock works

`qty` is packs on hand, in quarter steps below one: a bag of milk goes
1 → ¾ → ½ → "a little" (0.25) → out. Every item has a **low mark** (default
"a little"). The row's **−** steps one pack above one and a quarter below;
the item sheet has **Used one / Running low / All gone / Bought one**.

State, worked out on the server (`statusOf` in `pantry-stock.js`) and shipped
with every item so the views never re-derive it:

- **out**: qty 0.
- **low**: qty at or under the low mark.
- **due**: bought on at least three different days, the median gap since the
  last purchase has passed, and nobody has counted it since it fell due. This
  is what keeps the list right without tapping every use.
- **use soon**: has a shelf life (Claude estimates it per receipt line) and is
  within two days of it, or up to three days past ("check it"). Further past
  that it's **stale**, "still got it?", and stops nagging.

Out, low and due items are **on the list** unless snoozed ("not this week")
or archived ("don't need it any more"). Buying one again (a receipt, or
"got it" on the list) un-archives and un-snoozes. An item bought twice is
automatically **kept stocked** unless someone says otherwise.

## A receipt's life

1. **Photos**: up to four, top to bottom, shrunk to 2000px JPEG on the phone
   (EXIF dropped). Photos are never stored.
2. **Read** (`action: "read"`): Claude gets the photos plus every known item
   (id + name) and today's date, and returns lines: printed text, plain name,
   which known item it matches, category, where it's kept, packs, size, price,
   shelf days, and `keep: false` for bag fees and deposits. `sanitizeRead`
   drops unknown ids and fills blanks. A date that reads both ways
   ("11/03/26") becomes the reading nearest today that isn't in the future. A match the household confirmed on an earlier receipt
   (`pantry_aliases`, keyed by the printed text) beats Claude's guess.
3. **Review**: every line is editable. Nothing is saved until "Add N to the
   pantry".
4. **Save** (`action: "receipt"`): `planReceipt` folds lines onto existing
   items (by id, or by a name that already exists) and merges duplicates; one
   transaction then writes the header, new items, a `bought` event per item,
   restocks, learned aliases, and clears list extras it satisfied. The same
   store + day + total is caught as a duplicate (409) unless forced.
5. **Undo** (More → Recent receipts): subtracts that receipt's purchases and
   forgets it.

No API key: the read returns 503 `claude_unconfigured` and the page offers the
same review screen to type the receipt in.

## Setup (Vercel env)

Already set for the other private apps: `POSTGRES_URL`, `CLERK_SECRET_KEY`,
`REACT_APP_CLERK_PUBLISHABLE_KEY`, `BUDGET_ALLOWED_USER_IDS`, `CRON_SECRET`.

| Var | What for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Receipt reading and recipes. Without it, receipts are typed in and Cook is off. |
| `PANTRY_KITCHEN_TOKEN` | Turns on the kitchen display and feed. A long random string: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
| `PANTRY_ALLOWED_USER_IDS` | Optional. Narrows the pantry to the household; unset, it uses `BUDGET_ALLOWED_USER_IDS`. A 403 shows the user id to copy in. |
| `PANTRY_VAPID_PUBLIC_KEY` / `PANTRY_VAPID_PRIVATE_KEY` | Optional. Push keys; unset, Acta's `ACTA_VAPID_*` are used. `npx web-push generate-vapid-keys` |
| `PANTRY_TZ` | Optional. Defaults to `America/Toronto`. |
| `PANTRY_MODEL` | Optional. Defaults to `claude-haiku-5-5`. Set `claude-opus-5-5` if receipt reads aren't good enough (about 40× the cost; it also turns on the server-side refusal fallback, which Haiku doesn't have). |

The digest cron (`vercel.json`) calls plain `/api/pantry` at 21:00 UTC (5pm
Toronto in winter, 4pm in summer); the `CRON_SECRET` bearer is what routes it.
It only speaks up about things that are newly out, low, due or about to turn.

Cost is one Haiku 5.5 call per action, with a per-user cap of 10 per 10
minutes on each warm instance. Measured 2026-11-05 on a made-up 9-line
receipt: about $0.001 a receipt (~2,800 tokens in, ~1,700 out, 7–9 s) and
about $0.0013 per round of four recipes (~12 s). The same calls on Opus 5.5
would be about 10¢ together. A real phone photo is larger than the test
image, so expect a little more per receipt.

## Google Home in the kitchen

A web app can't put its own commands on a Google speaker any more:
Conversational Actions were shut down in 2023, and Vercel can't reach devices
on the home network. So Pantry exposes two read-only things a bridge in the
house can use:

- **Feed**: `GET /api/pantry?kitchen=<token>` returns
  `{ out, low, useSoon, extras, say }`, where `say` is one sentence ready to
  speak ("You're out of milk and eggs. Running low on bread. Use the spinach
  soon.").
- **Display**: `/pantry/kitchen?k=<token>`, a dark, big-type page sized for a
  Nest Hub or a tablet on the fridge. It refreshes every five minutes. Copy the
  link from More → Kitchen display.

The token is read-only and must stay that way: anyone with the link can see
the list, nothing more.

### With Home Assistant (recommended)

Speaker, on demand or on a schedule:

```yaml
rest:
  - resource: https://charliehaldane.ca/api/pantry?kitchen=YOUR_TOKEN
    scan_interval: 900
    sensor:
      - name: Pantry
        value_template: "{{ value_json.out | length + value_json.low | length }}"
        json_attributes: [say, out, low, useSoon, extras]

script:
  pantry_check:
    alias: Pantry check
    sequence:
      - action: homeassistant.update_entity
        target: { entity_id: sensor.pantry }
      - action: tts.speak
        target: { entity_id: tts.google_translate_en_com } # your TTS entity
        data:
          media_player_entity_id: media_player.kitchen # the Nest speaker
          message: "{{ state_attr('sensor.pantry', 'say') }}"
```

For "Hey Google, what are we low on?", expose `script.pantry_check` to Google
through Home Assistant's Google Assistant integration, then add a Google Home
household routine whose starter is that phrase and whose action runs the
script. For a Nest Hub, show the display page: put it in a Home Assistant
dashboard (Webpage card) and cast that view, or cast it from a computer on
the network with `catt cast_site <kitchen link>`. None of this has been tried
on the actual devices yet.

### Not built (on purpose, for now)

- **Voice in** ("we're out of milk"). It needs a write path from the house,
  which the read-only token deliberately isn't. If wanted: a second,
  separate token that only accepts `out` / `low` for an item named in plain
  words, called from a Home Assistant script.

## Rules worth keeping

- A Claude read is never saved without the review step, and aliases are only
  learned from saved (reviewed) receipts.
- Receipt photos are never stored, here or in the database.
- Days cross the wire as `YYYY-MM-DD` strings in the household's zone
  (`::text` / `to_char` in SQL), never as JS Dates.
- Status is computed in `pantry-stock.js` only; the UI and the kitchen feed
  consume it.
- `api/pantry.js` is the 12th and last function on the Hobby plan. The next
  app has to go behind an existing `[action]` router.
- The SQL in `pantry-db.js` (including the receipt transaction and undo) was
  exercised against in-memory Postgres (PGlite) through a Neon-shaped shim
  while it was built. Re-run that kind of check after changing a query; never
  test writes against the live database.
