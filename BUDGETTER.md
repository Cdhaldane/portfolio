# Budgetter — Project Goals & Architecture

> A private spending tracker at `/budgetter`: upload credit-card statements,
> see where the money goes, keep fixed monthly bills in the same picture, and
> stay under self-set budgets. Shared per **household**, so a couple works
> from one set of numbers. Invite-only (~5 people), security-first, and —
> because it lives on a portfolio site — built to the same visual bar as the
> public pages.

---

## 1. Vision

**The one-sentence job:** *"Somewhere I can upload my credit card statements
and actually see my spending — eating out, clothes, Amazon — next to the fixed
bills I pay every month."*

What that implies:

- **Upload-first, not bank-connection-first.** Amex/TD/Canadian Tire have no
  public consumer APIs; aggregators (Plaid/Flinks) mean handing over banking
  credentials. Uploading a CSV the bank already provides keeps the app out of
  the credential business entirely — 80% of the security problem deleted.
- **Three kinds of money leave a household:** variable card spending
  (statements), debit/chequing spending (bank statements), and fixed monthly
  payments — mortgage, insurance, hydro, water. Budgetter models all three:
  card and bank data are imported, fixed costs are declared once in the
  Income & bills tab and overlaid onto every month they're active.
  Chequing accounts are a different *kind* of import, not just another bank
  — see "Chequing imports" below.
- **Categories should mostly just work.** ~95 built-in Canadian merchant rules
  categorize on upload; personal rules (created by "apply to matching
  transactions") always override the built-ins; anything left gets a one-click
  Auto-categorize backfill.

## 2. Who it's for

The owner plus at most a handful of invited people. This is load-bearing:
sign-ups are **disabled** in Clerk, accounts are created by hand, and a
fail-closed env allowlist (`BUDGET_ALLOWED_USER_IDS`) means even a Clerk
misconfiguration admits no one. There is deliberately no self-serve anything.

**Households.** Money is rarely a solo activity, so the unit of ownership is
a *household*, not a person: one shared ledger with one or more members, all
of whom can read and write everything in it. Two people in a household see
identical numbers — there is no per-member private view, by design.

Joining is deliberately two-locked. Being allowlisted gets you *into
Budgetter* (with your own empty household); an **invite code** minted by a
household owner is what gets you into *their* household. Codes are single
use, expire in 7 days, and are stored only as a sha256 hash — the plaintext
is shown to the inviter once and can never be looked up again. Nobody has to
copy Clerk user ids around, and a leaked database row is not redeemable.

A join never merges or discards data: if the joiner's own household already
holds transactions, cards, bills, income, budgets or saved purchase plans,
the join is refused with an explanation instead of orphaning them. Removal is a soft `removed_at`, so
a departed member's imports and edits stay in the ledger, still credited to
them by name.

## 3. Security model

The React route is cosmetic; **the API is the security boundary.**

| Layer | Mechanism |
|---|---|
| Identity | Clerk session JWT, verified server-side (`@clerk/backend.verifyToken`) with `authorizedParties` pinned to this site's origins |
| Authorization | Fail-closed user-id allowlist checked in `requireUser()` — empty list = nobody |
| Tenancy | Every table carries `household_id`; every query filters by the household `resolveHousehold()` derives from the verified caller. A caller can never name a household — no request field is ever used as a tenancy key |
| Attribution | `user_id` survives on every table as "which member created this row" (never a filter). Departed members keep resolving to a name |
| Invites | Single-use, 7-day, sha256-hashed codes; owner-only to mint or revoke, capped at 5 live at once. Redeeming still requires a verified, allowlisted session |
| Data minimization | Only date / merchant / amount / last-4 are stored. Full card numbers are actively rejected (PAN-shaped input refused); raw statement files are parsed in the browser and never uploaded |
| Ingest hygiene | Server re-validates every row (dates, integer cents, length caps); `merchant_clean`, `category`, `dedup_hash` are always derived server-side, never trusted from the client |
| Discoverability | `noindex,nofollow`, `robots.txt` disallow, unlinked from all public nav |

Secrets live in `.env.local` (dev) and Vercel env vars (prod):
`CLERK_SECRET_KEY`, `BUDGET_ALLOWED_USER_IDS`, `POSTGRES_URL`,
`REACT_APP_CLERK_PUBLISHABLE_KEY` (public by design).

## 4. Architecture

- **Frontend:** CRA SPA. `/budgetter` is a lazy chunk behind `BudgetGate`
  (Clerk `<SignIn>`, theme-aware). Six tabs — Dashboard, Upload,
  Transactions, Monthly, Afford, Household — all kept mounted with
  bidirectional refresh wiring (imports and category edits refresh the
  dashboard; dashboard mutations refresh the list; the Afford planner pushing
  a purchase into Monthly payments refreshes both the dashboard and the
  already-mounted Monthly list; a household join refreshes everything, since
  it swaps the whole ledger). The `/api/budget/household` fetch lives in
  `Budgetter.jsx` rather than in the panel, because the Transactions list
  needs the same member names to render "added by" — one request, one source
  of truth.
- **API:** ONE Vercel serverless function — `api/budget/[action].js` — that
  dispatches to per-route handlers in `api/_lib/handlers/` (Hobby plan caps
  deployments at 12 functions and counts files, so the twelve budget routes
  share a single dynamic function; URLs are unchanged). Handlers share
  `api/_lib/budget-auth.js` (auth), `budget-household.js` (tenancy: resolve /
  invite / join / remove), `budget-invite.js` (pure code minting + hashing),
  `budget-db.js` (Neon client + schema), `budget-normalize.js`
  (validation/cleanup/categorization — pure). The pure modules are unit-tested
  via `npm run test:api` (node's built-in runner — CRA's jest only collects
  tests under `src/`). New budget endpoints = new handler file + one line in
  the dispatcher map, NOT a new file directly under `api/`.
- **Handler shape:** `requireUser()` (identity + allowlist, no DB) →
  `getSql()` → `ensureTables()` → `resolveHousehold()` → data. Auth stays
  first so an unauthenticated caller learns nothing about server config.
  ⚠️ In a handler that delegates to sub-functions, `await` them inside the
  try — a bare `return handler(...)` lets rejections escape the catch, and
  expected refusals (bad invite code, not the owner) arrive as rejections.
- **DB:** Neon Postgres (same instance as the guestbook), tables prefixed
  `budget_`.

### Data model

Every table below carries `household_id` (the tenancy key, NOT NULL) and
`user_id` (attribution: who created the row).

```
budget_meta            key -> value          (schema_version, migration gate)
budget_households      owner_user_id UNIQUE, name
budget_household_members  household_id, user_id, role, display_name,
                       joined_at, removed_at
                       UNIQUE(household_id, user_id) + partial UNIQUE(user_id)
                       WHERE removed_at IS NULL  — one ACTIVE household each
budget_household_invites  household_id, code_hash UNIQUE, label, created_by,
                       expires_at, redeemed_by, redeemed_at
budget_accounts        bank, label, last4, member_user_id (whose card),
                       kind ('card' | 'chequing' — immutable after
                       creation; decides how uploads are interpreted)
budget_upload_batches  account_id, filename, row/inserted/duplicate/rejected counts
budget_transactions    account_id, batch_id, posted_date,
                       merchant_raw, merchant_clean, amount_cents,
                       category, dedup_hash  UNIQUE(household_id, dedup_hash)
budget_category_rules  pattern -> category   UNIQUE(household_id, pattern)
budget_budgets         category, monthly_cents  UNIQUE(household_id, category)
budget_recurring       label, category, amount_cents, due_day,
                       start_month, end_month, on_card, paid_from,
                       member_user_id (whose bill; NULL = shared —
                       split evenly in per-person views)    (bills)
budget_income          label, amount_cents, cadence, start_month,
                       end_month, member_user_id (whose income —
                       always owned; backfilled to creator)
                                                 (paycheques etc.)
budget_plans           label, price_cents, tax_bps, down_cents,
                       trade_in_cents, apr_bps, term_months,
                       insurance_cents, fuel_cents, maintenance_cents,
                       start_month        (Afford tab purchase scenarios)
```

⚠️ **`budget_plans` stores INPUTS ONLY** — rates as basis points (690 =
6.9%), money as cents. Every derived figure (payment, interest, the
affordability verdict, the affordable sticker price) is computed in the
browser by `src/Pages/Budgetter/Afford/loan.js`, so improving the maths never
needs a migration or a backfill, and two household members always see the
same arithmetic. It is also the one table created *after* households existed:
`household_id` is `NOT NULL` from birth, it is absent from `TENANT_TABLES`
(nothing to backfill), and its index is created in the unconditional DDL block
because the version-gated migration never runs again on an existing database.

⚠️ **Two different questions about "whose":** `member_user_id` (on accounts,
recurring, income) is *ownership* — whose card, whose bill, whose paycheque —
and drives every per-person number; `user_id` is *who typed it in*
(attribution). One member can import and enter everything and the per-person
split still comes out right. Don't conflate them. Recurring is the one place
NULL ownership means something: a shared household bill, split evenly in
per-person math.

⚠️ **Hash scope invariant:** `dedup_hash` is salted with the household
**owner's** user id (`household.hashScope`), never the caller's. For every
pre-household row the two were the same value, so historical hashes stay
valid — and both members uploading the same statement now produce the same
hash, so the second upload dedupes instead of double-importing. Never salt it
with the uploader's id.

Schema migrations are gated on `budget_meta.schema_version` (currently 2) so a
cold start pays one cheap `SELECT` instead of replaying ~25 idempotent
DDL/backfill statements against Neon. The household migration backfills
`household_id` from the owner map, swaps the three per-user UNIQUE
constraints for per-household unique indexes, then sets `NOT NULL` — and
skips the `NOT NULL` step with a logged warning if any row somehow lacks a
household, because a stray NULL makes a row *invisible* (filters are
`household_id = N`) rather than visible to the wrong household.

Conventions: **integer cents everywhere** (positive = charge, negative =
credit); month keys are `"YYYY-MM"` strings (compare lexicographically);
recurring items and income sources are *not* materialized into transactions —
the dashboard overlays them per month from their `[start_month, end_month]`
window, so editing an amount retroactively corrects history and there's no
cron. Income cadences normalize to a monthly **average** (weekly ×52÷12,
biweekly ×26÷12, semimonthly ×2) — deliberately no payday-calendar math, so
savings-per-month reads against a steady baseline. Savings = income −
(card charges + fixed); card *credits* (refunds, statement payments) are
excluded from spend, so a statement payment never double-counts against
income.

**No double-counting rule:** a recurring item flagged `on_card` (cell phone
or streaming billed to a tracked credit card) is listed in the Income & bills tab
and its due date is reminded about, but it is **excluded from every
dashboard number** — the real charges arrive via statement upload and those
are what count. The subscription detector's "Track" button always sets
`on_card` (detected subs come from statement data by definition).

**Split / exclude:** `budget_transactions.count_pct` (0–100, default 100)
weights every aggregate: 0 = excluded (work reimbursed it), 50 = split half
with someone. `amount_cents` is never rewritten — the original charge stays
auditable, and the UI shows the effective amount with a % chip. Every
summary aggregation multiplies by it (`ROUND(amount_cents * count_pct /
100.0)`).

**Bill reminder emails:** a daily Vercel cron (12:00 UTC → morning in
`REMINDER_TZ`) hits `/api/budget/reminders`, authenticated by `CRON_SECRET`
as a Bearer token (fail closed: unset secret = 503). Bills whose `due_day`
lands exactly `REMINDER_DAYS_AHEAD` days out (month-end clamped) are grouped
per household and sent to **every current member** — one email each, one
recipient per message so nobody's address is disclosed to the others — via
the same Brevo SMTP the contact form uses; recipient addresses come from
Clerk at send time, the budget DB never stores emails. Daily run + exact-day
match = idempotent without a sent-log. `?dryRun=1` previews without sending.

### Ingest pipeline

browser: parse CSV (papaparse) → detect/confirm column mapping → normalize
rows → **dry-run** (server previews new/duplicate/rejected counts) → user
confirms → **commit** (strict `commit === true`).
PDF statements (Canadian Tire / Triangle, which offers no CSV; also Amex,
TD and Kawartha / Libro) take a parallel client-side path: pdf.js (lazy
chunk) extracts text lines → `pdf-parsers.js` state machine finds the
transaction tables, infers years from the statement period, and cross-checks
parsed sums against the statement's own printed "Total …" lines → user
reviews the extracted rows → same dry-run/commit. The raw PDF never leaves
the browser either.

A **chequing** account inserts one more step between dry-run and commit: the
dry-run returns a per-row *treatment* (keyed by the row's index in the
submitted array) and the review table lets the user confirm or flip each one
before committing. See "Chequing imports".
Server: re-validate → clean merchant → occurrence-aware dedup hash (the Nth
identical same-day tuple is a *real* repeat purchase, not a duplicate) →
user rules then default rules (longest-pattern-first, word-boundary matching
for defaults) → single-transaction bulk insert with `ON CONFLICT DO NOTHING`.

⚠️ **Invariant:** `dedup_hash` includes `merchant_clean`. Changing
`cleanMerchant()` re-keys affected rows and can double-import on overlapping
re-uploads. Change it only deliberately.

### Chequing imports

A card statement is almost all spending — import every row and the dashboard
is right. A **bank account statement is not**, and treating one like a card
actively corrupts the numbers. On the real August 2026 Kawartha statement
this was built against, **$4,894.85 left the account and only $239.90 of it
was spending.** The rest:

| Row | Why it isn't spending |
|---|---|
| `Online Bill Payment Canadian Tire Mastercard` −$1,105.70 | Pays a card whose charges are **already imported** from its own statement. Counting it counts that spending twice. |
| `Withdrawal Weekly deposit from Charlie` −$500 ×5 | Transfer to the household's joint chequing account. ~$2,500/mo of invented spending, and a wrecked savings rate. |
| `AVISO FNCL` −$25 ×5, `MD Tfr to …6011` −$62.90 | Investment contributions and internal transfers — savings, not spending. |
| `407 ETR` −$573.86, `AVIVA INSURANCE` −$187.49 | Fixed bills **already declared** in the Income & bills tab, which the dashboard overlays onto every active month. |
| `Payroll Deposit NATIONAL SHUNT SERVICE LTD` +$999.65 ×4 | Income. Credits never count as spend, and `budget_income` stays the source of truth for what comes in. |

`api/_lib/budget-chequing.js` (pure, unit-tested) handles this in two parts:

1. **`CHEQUING_RULES`** — word-boundary patterns for card payments,
   transfers and savings, each carrying a category, a `countPct` and a
   human-readable reason. They slot into `categoryFor()` as `extraRules`,
   **between** the user's own rules and the built-in merchant defaults, so
   "… CANADIAN TIRE MASTERCARD" is a card payment rather than Shopping.
2. **`matchDeclaredBill()`** — compares each debit against the household's
   live `budget_recurring` rows. `high` confidence = the bill's own words
   appear in the description, or the amount matches to the cent in an active
   month; `likely` = within 5% (or $2) **and** within 3 days of the declared
   due day. Nothing else matches.

**Excluded, not dropped.** A held-back row is still imported, at
`count_pct = 0`. `amount_cents` is never rewritten, so the bank's own record
stays auditable, the row shows in the Transactions list with a 0% chip, and
one click promotes it back to counting. Dropping rows would silently lose
data the statement actually reported.

⚠️ **Precedence matters, in this order** (and a regression test pins it):

1. **A pattern rule that excludes the row wins outright.** A description
   that says TRANSFER or names a credit card has identified itself and must
   not be second-guessed by a heuristic on amount and date. This is not
   hypothetical: the Aug 28 **$500.00** transfer lands on the 28th, which is
   also the declared due day of a **$540** toll bill — under the original
   (looser, bill-first) matching it was claimed as that bill. Mislabelling a
   transfer is the harmless version; the same coincidence on a real purchase
   would have **hidden** it.
2. Then a declared bill — the household declared it and the dashboard
   already counts the declaration, so the imported duplicate gives way.
3. Then a pattern rule that only categorizes (tolls, a loan payment, cash).
4. Otherwise ordinary spending.

⚠️ **A false bill match hides real spending; a miss only double-counts
something visible in the review table.** That asymmetry is why the `likely`
window is tight and why bills whose amount genuinely swings are matched by
label (exact) rather than amount.

This is the mirror image of the `on_card` rule: there, a declared bill
charged to a tracked card is excluded from dashboard math because the real
charge arrives by upload. Here the declared bill stays the source of truth
and the imported duplicate is excluded — same principle, opposite side. The
alternative (let the real debit count and exclude the declaration) would
need an `on_card`-style flag on `budget_recurring`; deliberately not built,
because the declared row is also what drives the reminder emails.

⚠️ **Sign inversion.** A bank statement is written from the bank's side:
debits negative, credits positive. Budgetter's convention is "positive =
money out". `parseKawarthaStatement` negates every amount on the way out, so
a chequing withdrawal aggregates exactly like a card charge and a deposit
drops out of spend totals exactly like a card credit. Misrouting a bank
statement to a card parser would invert every sign, which is why
`parseStatementPdf` tests the Kawartha marker **first**.

**Trust boundary.** `countPct` is the one client-supplied *decision* the
upload endpoint accepts, validated to the same 0–100 integer range as the
transactions PATCH. A row arriving without one falls back to the **server's**
own suggestion, never to a bare 100 — a client bug cannot silently resurrect
the double-counting the suggestions exist to prevent. A stale personal
category rule can change a row's *label* but never its `countPct`.

**The running-balance check.** Kawartha prints a balance after every row,
which makes `previous + amount == printed` a per-row proof that the amount
*and its sign* were read correctly — much stronger than the card parsers'
section subtotals, which can only catch an error somewhere in a whole
section. `chainMismatches` names the exact offending row in the review UI,
alongside the statement's own "Total Debits"/"Total Credits" and closing
balance as independent checks. The balance itself is never sent to the
server.

## 5. Feature matrix (current)

- ✅ Auth gate + allowlisted API (11 endpoints, all fail closed)
- ✅ Households: one shared ledger per household, invite-code joining
  (single-use, 7-day, hash-only storage), member list with display names,
  owner-only invite/revoke/remove, soft removal that preserves attribution
- ✅ Attribution: every row records the member who created it; the
  Transactions list shows "… added this" and filters by member (both hidden
  in a solo household), and the CSV export carries an `AddedBy` column
- ✅ Per-person view: cards are assigned to a member (`member_user_id`), so
  spend-per-person is correct no matter who uploaded the statement
- ✅ Household / per-member scope: in a shared household the dashboard has
  one pill per member plus Household, and EVERYTHING answers for the active
  scope — chart, categories (incl. bill shares), merchants, movers,
  subscriptions, drill-downs, and the tiles. A member's numbers are real:
  their cards' charges + their own bills + an even 1/N share of shared
  bills, against their own income — so per-person savings is arithmetic,
  not an estimate. Budgets are the one deliberate exception (household
  caps; chipped "household" in a member scope). The summary splits
  months/merchants rows per card owner (`member_user_id`, grouped
  server-side — consumers must sum across rows), so the pills are a
  client-side flip, not a refetch. The Transactions list defaults to "Your
  cards" (combined whose-card / added-by filter). Solo households see none
  of this.
- ✅ Saved-by-month chart: diverging bars around a $0 baseline (sage above,
  coral below — position carries the sign, words ride in the tooltip/labels)
  tracking income − money out per month or year in the active scope.
- ✅ Custom dropdown (`src/Pages/Budgetter/Dropdown.jsx`, `.bdd-*`) replaces
  every native `<select>`: the OS paints native option popups, which ignored
  the theme entirely (grey-on-white options in dark mode). ARIA select-only
  combobox pattern (focus stays on the trigger, aria-activedescendant,
  arrows/Home/End/type-ahead/Esc), option groups + disabled options, spring
  pop-in with staggered rows and a self-drawing checkmark, drop-up near the
  viewport bottom, closes on outside click/scroll like a native select. The
  popup is PORTALED into the `.bud` wrapper — in place it would be clipped
  by overflow-hidden lists and mispositioned by backdrop-filter cards; on
  `<body>` it would lose the theme tokens.
- ✅ Per-person card on the dashboard: side-by-side money out / income /
  kept for both members in the selected period; tapping a person focuses
  the whole dashboard on them. (Replaced the Household tab's spend-per-
  person list — that tab is pure admin now.)
- ✅ CSV upload: Amex format verified against a real statement (41/41 rows);
  generic column-mapping UI for any other bank; dry-run review before commit
- ✅ PDF upload: Amex, Canadian Tire / Triangle, TD and Kawartha / Libro
  statements parsed in-browser (pdf.js) with bank auto-detection, each
  verified against real statements; stated totals (section totals /
  "CALCULATING YOUR BALANCE" / Amex's "Total of …" lines / a bank
  statement's Total Debits & Credits) cross-checked against parsed sums so
  layout drift fails loudly instead of importing garbage
- ✅ **Chequing / debit import** (Kawartha / Libro, verified against a real
  Aug–Sep 2026 statement): accounts carry a `kind`, signs are inverted into
  Budgetter's money-out convention, and a row-by-row review holds back card
  payments, internal transfers, savings contributions and bills already
  declared in the Income & bills tab — at `count_pct = 0`, so they stay on
  the record without counting. Verified end to end: the fixture's $4,894.85
  of debits resolves to $239.90 of spending. Every row is checked against
  the statement's own running balance, so a misread digit or a dropped minus
  sign is caught on the exact row that caused it.
- ✅ Auto-categorization: ~95 built-in rules + personal overrides + backfill
- ✅ Dashboard: KPI tiles (latest month + delta + sparkline, fixed monthly,
  average, uncategorized), stacked card+fixed bar chart (12 months / years),
  per-period category breakdown, top merchants, MoM movers,
  subscription detection ("looks recurring — track it?")
- ✅ Budgets: per-category monthly caps with over-budget states
- ✅ Monthly payments: CRUD for fixed costs, end-vs-delete semantics,
  next-30-days due list, free-text "paid from" account label (chequing /
  joint / a card) with datalist suggestions — display + reconciliation
  only, no dashboard math reads it
- ✅ Income & savings: cadence-normalized income sources (weekly/biweekly/
  semimonthly/monthly), "Saved this month" tile with savings rate + 12-mo
  running total, income benchmark ticks on the spend chart (bar above the
  tick = overspent), savings line in Insights, and a "fixed + budgets vs
  income" planning pulse under Budgets
- ✅ Transactions: search, category filter, inline edit w/ apply-to-future,
  split/exclude (count 0–100% of any charge), CSV export
  (formula-injection-safe, includes counted amounts)
- ✅ **Afford — big-purchase planner** (built for the car question): price /
  tax / cash down / trade-in / APR / term / running costs in, and out comes
  the monthly payment, the total cost of borrowing, and a **recommended
  monthly limit for everything the vehicle costs**, derived from a trailing
  6-month baseline of real statements and bills (the current, usually partial,
  month is dropped so the recommendation can't be flattered by an incomplete
  statement). Four tiers — recommended / comfortable / stretch / ceiling —
  plus the 20/4/10 rule of thumb (all transport under 10% of income), where
  `recommended = min(half your spare cash, 10% of income)`. Surplus uses the
  dashboard's exact "saved this month" definition, so the two surfaces can't
  disagree. Also: the *leanest* month as a stress test, the affordable sticker
  price at the current rate/term/down, months-of-saving runway for the down
  payment, a projected before/after monthly-outflow chart against income, a
  balance-vs-cash-paid chart over the whole term, the principal/interest
  split, a full payment schedule, and side-by-side comparison of saved
  scenarios (household-shared, max 12). "Bought it" writes the payment (with
  its real end month) and the insurance into Monthly payments — never fuel or
  maintenance, which arrive as card charges and would double-count
- ✅ Statement freshness chips: per-account "data through …" /
  "nothing since …" on the dashboard, click-through to Upload
- ✅ Bill reminder emails: daily cron, grouped per household and sent to every
  member, N days before each due date (see the reminders section above)
- ✅ Design: dataviz-method charts (single-hue magnitude palette, validated
  contrast in both themes), reduced-motion paths, mobile fallbacks,
  dev-only `/budgetter-preview` harness with mock data for design review
- ✅ Ambient background (`BudBackground`, shared by app + gate + preview):
  viewport-fixed ledger grid + drifting blue→sage→coral aurora + grain;
  transform-only animation, theme-aware blend modes, reduced-motion static

## 6. Design system notes

Follows the site's tokens (CLAUDE.md). Chart-specific decisions, validated
computationally (script-checked, not eyeballed):

- Spending is a *magnitude* job → single blue ramp for data. Card spend
  `--blue`, fixed costs `--blue-deep`; never a categorical rainbow.
- Sage/coral are **status only** (good/bad deltas, over-budget) and always
  accompanied by signed text — color is never the sole channel. Status *text*
  uses dedicated WCAG-passing tokens (`--good-text`/`--bad-text`, 4.5:1+ in
  both themes), never the raw brand hues.
- Bars ≤24px, 4px rounded data-ends, square baselines, 2px surface gap
  between stacked segments, hairline solid gridlines, one direct label
  (selected bar), tooltips + the Transactions table carrying the rest.

## 7. Known limitations / deliberate scope cuts

- The TD CSV layout is still an unverified guess — the mapping-confirmation
  step is the safety net until a real export is seen. (Triangle and TD are
  handled via their PDF statements instead; Amex CSV is verified.)
- Removing a member deliberately does NOT rewrite their data: their cards,
  personal bills and income keep the departed owner (soft-remove keeps names
  resolving), stay in Household-scope numbers, and simply have no scope pill
  anymore. The remaining member can still edit those rows — the PATCH
  handlers only validate an ownership CHANGE against active members — and
  should End or reassign them as real life dictates. Auto-reassigning (or
  auto-sharing) on removal would silently rewrite per-person history.
- Shared bills split evenly (1/N per active member, rounded per bill).
  Income-proportional splits are a possible future refinement; even splits
  are predictable and match how this household actually operates.
- The PDF parsers are layout-based (Triangle: section headings + "Total …"
  lines; TD: row shape + the balance box; Amex: "New Payments" / "New
  Transactions for …" / "Other Account Transactions" sections + their
  "Total of …" lines; Kawartha: one date per row, two money columns, and the
  running balance). A statement redesign breaks them loudly — totals
  mismatch or zero rows — never silently.
- **A Kawartha statement covering two accounts with activity is refused**,
  not blended. The fixture's second account (a registered one) is dormant,
  so the common case works; a month where both moved needs splitting first.
  Rows are attributed to the `… ACCOUNT <number>` heading above them.
- **Chequing spend lands in the same aggregates as card spend.** That's
  arithmetically right — it's all real spending, and the Afford tab's
  trailing baseline gets *more* accurate for it — but some dashboard copy
  still says "card" where it now means "card + chequing". Labels only; no
  number is wrong.
- Reference numbers in chequing descriptions are stripped before storage:
  a 7+ digit run is masked to its last four (`Deposit Transfer from
  (…6011)`) and a per-transaction trace code (`DB567F0200000000020`) is
  dropped entirely. The masking parentheses are load-bearing —
  `cleanMerchant()` strips a *trailing* digit run, and the closing bracket
  is what stops it eating the mask.
- The chequing rules include a few patterns specific to this household's
  statements (`AVISO FNCL`, `NSLSC`, `407 ETR`, `WEEKLY DEPOSIT FROM`),
  in the same spirit as the ~95 hardcoded Canadian merchant defaults. A
  rules-management UI (roadmap #2) is where these would eventually become
  editable rather than compiled in.
- "Safe to spend / left this month" math is still out of scope (income
  tracking itself is done — see the feature matrix). The Afford tab answers
  the *next-purchase* version of that question, not the day-to-day one.
- The Afford planner projects a **flat** baseline: today's 6-month average
  spending, repeated forward. It is deliberately not a forecast — no seasonal
  curve, no inflation, no raise. Income *is* projected properly (from each
  source's `[start_month, end_month]` window), so a paycheque that ends mid-
  projection shows up. The running costs are whatever you type; nobody is
  pricing insurance for you.
- A purchase scenario is not a commitment: it never enters the dashboard's
  numbers until "Bought it" writes real `budget_recurring` rows. That's a
  one-way door by design (delete them in the Income & bills tab), and the button
  latches after a successful push so a second click can't duplicate them.
- No category-rules management UI (rules are created via apply-to-future;
  a wrong rule currently needs a DB edit — planned below).
- Summary endpoint aggregates per merchant per month; fine at personal scale,
  needs windowing if a user ever has thousands of distinct merchants.
- Budgets are monthly-only by design.
- **Household visibility is all-or-nothing.** A member sees every
  transaction, bill and income source in the household. There is no private
  category or hidden card — if that's ever wanted, it's a real feature, not a
  config flag.
- **No household merge.** Two households with data can't be combined; the
  join is refused rather than guessing. One side has to start empty.
- Only the *owner* can invite, revoke or remove, and ownership can't be
  transferred — deliberate while the app is this small, but it does mean the
  owner's Clerk account is a single point of administration.
- `resolveHousehold()` costs one extra indexed round trip per request. Fine at
  this scale; it's the obvious thing to cache (short TTL) if it ever matters.

## 8. Roadmap

1. **Transaction notes + "flag for review"** — the natural next household
   feature: one member flags a mystery charge, the other answers it inline.
   A `note` column, a `needs_review` flag, and a dashboard tile counting them.
2. **Rules manager** — list/edit/delete `budget_category_rules` (removes the
   only unrecoverable-via-UI state in the app).
3. **Activity log** — who changed what, when. Cheap now that every row
   records its author; the value is in mutations (deleted a bill, edited an
   amount), which aren't currently recorded anywhere.
4. ~~TD + Triangle parsers~~ — both done via PDF import, verified against
   real statements (TD June 2026, Triangle June+July 2026), and Amex PDF
   followed (verified against a real August 2026 Cobalt statement, so a
   member without CSV access can upload too). TD *CSV* mapping remains
   unverified but is covered by the manual-mapping fallback.
5. OFX/QFX import (richer than CSV, includes bank transaction ids —
   would also make dedup exact instead of heuristic). Most valuable for the
   chequing path, where transfer/payment detection is currently pattern work.
6. **Transfer pairing** — a $500 debit out of chequing and the matching
   credit into the joint account are currently two independent excluded
   rows. Pairing them (same amount, opposite sign, both tracked accounts,
   within a day or two) would let the app *prove* a transfer rather than
   infer it from wording, and show a real savings flow.
7. **Reconcile declared income against imported payroll** — the deposits are
   now labelled but income stays a declared cadence average, so a raise or a
   missed cheque doesn't surface. Deliberately deferred (see §1).
8. "Left to spend this month" — income and fixed costs are both modelled now,
   so this is mostly assembly plus a day-pro-rated pace indicator. The Afford
   tab already owns the trailing-baseline maths (`Afford/loan.js`
   `spendBaseline`), which is the reusable half.
9. ~~Per-account (and now per-member) filtering surfaced in the dashboard~~ —
   done as the Mine/Household scope toggle (dashboard) plus the whose-card /
   added-by filter (Transactions, `cardOf` param). Per-account filtering in
   the dashboard remains unexposed (the API supports it).
8. Plaid/Flinks connection — **only if** manual monthly uploads become a
   chore; explicitly a liability trade, feature-flagged, TD first.

---

*Maintenance notes: schema changes go in `budget-db.js` `ensureTables()`
(idempotent `CREATE TABLE IF NOT EXISTS`). Anything beyond an additive column
— backfills, constraint swaps, `NOT NULL` — goes in a version-gated migration
function like `migrateToHouseholds()` with `SCHEMA_VERSION` bumped, so it runs
once per database instead of on every cold start. Every new endpoint starts
with `requireUser()`, then `resolveHousehold()`, then filters by
`household_id`; no exceptions. Writes also stamp `user_id` with the acting
member for attribution.*

*Testing: `npm run test:api` covers the pure server helpers; `npm test` covers
the pure browser maths — the PDF parsers plus `Afford/loan.test.js` (33 cases:
amortization cross-checked against a standard loan table, the
payment↔principal inverse, the affordability tiers, and the degenerate cases —
0% APR, cash purchase, no income on file, a household already overspending).
The household
migration and every handler were additionally verified end-to-end against a
throwaway local Postgres seeded with pre-household data (backfill correctness,
constraint swap, cross-household dedup isolation, tenancy isolation before a
join, identical numbers after one, cross-member re-upload dedup, reminder
fan-out, and access loss on removal).*
