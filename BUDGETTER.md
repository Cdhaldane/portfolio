# Budgetter — Project Goals & Architecture

> A private spending tracker at `/budgetter`: upload credit-card statements,
> see where the money goes, keep fixed monthly bills in the same picture, and
> stay under self-set budgets. Invite-only (~5 people), security-first, and —
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
- **Two kinds of money leave a household:** variable card spending (statements)
  and fixed monthly payments that never hit a card — mortgage, insurance,
  hydro, water. Budgetter models both: card data is imported, fixed costs are
  declared once in the Monthly tab and overlaid onto every month they're
  active.
- **Categories should mostly just work.** ~95 built-in Canadian merchant rules
  categorize on upload; personal rules (created by "apply to matching
  transactions") always override the built-ins; anything left gets a one-click
  Auto-categorize backfill.

## 2. Who it's for

The owner plus at most a handful of invited people. This is load-bearing:
sign-ups are **disabled** in Clerk, accounts are created by hand, and a
fail-closed env allowlist (`BUDGET_ALLOWED_USER_IDS`) means even a Clerk
misconfiguration admits no one. There is deliberately no self-serve anything.

## 3. Security model

The React route is cosmetic; **the API is the security boundary.**

| Layer | Mechanism |
|---|---|
| Identity | Clerk session JWT, verified server-side (`@clerk/backend.verifyToken`) with `authorizedParties` pinned to this site's origins |
| Authorization | Fail-closed user-id allowlist checked in `requireUser()` — empty list = nobody |
| Tenancy | Every table carries `user_id`; every query filters by the verified caller's id — no cross-user query exists |
| Data minimization | Only date / merchant / amount / last-4 are stored. Full card numbers are actively rejected (PAN-shaped input refused); raw statement files are parsed in the browser and never uploaded |
| Ingest hygiene | Server re-validates every row (dates, integer cents, length caps); `merchant_clean`, `category`, `dedup_hash` are always derived server-side, never trusted from the client |
| Discoverability | `noindex,nofollow`, `robots.txt` disallow, unlinked from all public nav |

Secrets live in `.env.local` (dev) and Vercel env vars (prod):
`CLERK_SECRET_KEY`, `BUDGET_ALLOWED_USER_IDS`, `POSTGRES_URL`,
`REACT_APP_CLERK_PUBLISHABLE_KEY` (public by design).

## 4. Architecture

- **Frontend:** CRA SPA. `/budgetter` is a lazy chunk behind `BudgetGate`
  (Clerk `<SignIn>`, theme-aware). Four tabs — Dashboard, Upload,
  Transactions, Monthly — all kept mounted with bidirectional refresh wiring
  (imports and category edits refresh the dashboard; dashboard mutations
  refresh the list).
- **API:** Vercel serverless functions in `api/budget/*`, sharing
  `api/_lib/budget-auth.js` (auth), `budget-db.js` (Neon client + schema),
  `budget-normalize.js` (validation/cleanup/categorization — pure, unit-tested).
- **DB:** Neon Postgres (same instance as the guestbook), tables prefixed
  `budget_`.

### Data model

```
budget_accounts        user_id, bank, label, last4
budget_upload_batches  user_id, account_id, filename, row/inserted/duplicate/rejected counts
budget_transactions    user_id, account_id, batch_id, posted_date,
                       merchant_raw, merchant_clean, amount_cents,
                       category, dedup_hash  UNIQUE(user_id, dedup_hash)
budget_category_rules  user_id, pattern -> category   (user overrides)
budget_budgets         user_id, category, monthly_cents
budget_recurring       user_id, label, category, amount_cents, due_day,
                       start_month, end_month, on_card, paid_from
                                              (fixed monthly payments)
budget_income          user_id, label, amount_cents, cadence,
                       start_month, end_month        (paycheques etc.)
```

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
or streaming billed to a tracked credit card) is listed in the Monthly tab
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
into one plain-text email per user via the same Brevo SMTP the contact form
uses; recipient addresses come from Clerk at send time — the budget DB never
stores emails. Daily run + exact-day match = idempotent without a sent-log.
`?dryRun=1` previews without sending.

### Ingest pipeline

browser: parse CSV (papaparse) → detect/confirm column mapping → normalize
rows → **dry-run** (server previews new/duplicate/rejected counts) → user
confirms → **commit** (strict `commit === true`).
PDF statements (Canadian Tire / Triangle, which offers no CSV) take a
parallel client-side path: pdf.js (lazy chunk) extracts text lines →
`pdf-parsers.js` state machine finds the transaction tables, infers years
from the statement period, and cross-checks parsed sums against the
statement's own printed "Total …" lines → user reviews the extracted rows →
same dry-run/commit. The raw PDF never leaves the browser either.
Server: re-validate → clean merchant → occurrence-aware dedup hash (the Nth
identical same-day tuple is a *real* repeat purchase, not a duplicate) →
user rules then default rules (longest-pattern-first, word-boundary matching
for defaults) → single-transaction bulk insert with `ON CONFLICT DO NOTHING`.

⚠️ **Invariant:** `dedup_hash` includes `merchant_clean`. Changing
`cleanMerchant()` re-keys affected rows and can double-import on overlapping
re-uploads. Change it only deliberately.

## 5. Feature matrix (current)

- ✅ Auth gate + allowlisted API (9 endpoints, all fail closed)
- ✅ CSV upload: Amex format verified against a real statement (41/41 rows);
  generic column-mapping UI for any other bank; dry-run review before commit
- ✅ PDF upload: Canadian Tire / Triangle Mastercard statements parsed
  in-browser (pdf.js), verified against a real July 2026 statement; section
  totals cross-checked against the statement's own so layout drift fails
  loudly instead of importing garbage
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
- ✅ Statement freshness chips: per-account "data through …" /
  "nothing since …" on the dashboard, click-through to Upload
- ✅ Bill reminder emails: daily cron, grouped per user, N days before each
  due date (see the reminders section above)
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
  step is the safety net until a real export is seen. (Triangle is handled
  via its PDF statements instead; Amex is verified.)
- The Triangle PDF parser is layout-based (section headings + "Total …"
  cross-checks). A statement redesign breaks it loudly — totals mismatch or
  zero rows — never silently.
- No income tracking; "safe to spend" math is out of scope for now.
- No category-rules management UI (rules are created via apply-to-future;
  a wrong rule currently needs a DB edit — planned below).
- Summary endpoint aggregates per merchant per month; fine at personal scale,
  needs windowing if a user ever has thousands of distinct merchants.
- Budgets are monthly-only by design.

## 8. Roadmap

1. **Rules manager** — list/edit/delete `budget_category_rules` (removes the
   only unrecoverable-via-UI state in the app).
2. **TD parser** verified against a real export (same treatment the Amex
   format got). ~~Triangle~~ done via PDF import (statement-verified).
3. OFX/QFX import (richer than CSV, includes bank transaction ids —
   would also make dedup exact instead of heuristic).
4. Income + "left to spend this month" once statements include deposits.
5. Per-account filtering surfaced in the dashboard (API already supports it).
6. Plaid/Flinks connection — **only if** manual monthly uploads become a
   chore; explicitly a liability trade, feature-flagged, TD first.

---

*Maintenance notes: schema changes go in `budget-db.js` `ensureTables()`
(idempotent `CREATE TABLE IF NOT EXISTS` — additive only; column changes need
manual `ALTER TABLE` against Neon). Every new endpoint starts with
`requireUser()` and a `user_id` filter; no exceptions.*
