// Vercel serverless function — GET /api/budget/reminders
// Bill-reminder emails, fired by the daily Vercel cron (see vercel.json).
//
// NOT a user endpoint: there is no session here, so instead of requireUser
// it authenticates the CRON itself — Vercel sends
// "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET env var is set.
// Fail closed: no CRON_SECRET configured -> 503, wrong/missing bearer -> 401.
//
// For every ACTIVE recurring item with a due_day landing exactly
// REMINDER_DAYS_AHEAD days from now (default 3), the owning user gets ONE
// grouped email listing that day's bills. Running daily + exact-day match =
// naturally idempotent, no sent-log table needed. Recipient addresses come
// from Clerk (the only place emails live — the budget DB stores none).
//
// ?dryRun=1 returns what WOULD be sent without sending — same auth.
const { createClerkClient } = require("@clerk/backend");
const nodemailer = require("nodemailer");
const { getSql, ensureTables } = require("../budget-db");

if (!process.env.CRON_SECRET) {
  try {
    require("dotenv").config({
      path: require("path").resolve(__dirname, "../../../.env.local"),
    });
  } catch (_) {
    /* dotenv/file missing — the 503 below handles it */
  }
}

const REMINDER_DAYS_AHEAD = Number(process.env.REMINDER_DAYS_AHEAD) || 3;
// Due days are "the 22nd" in the user's life, not UTC's — anchor "today" to
// this zone so late-evening cron runs don't slip a day.
const REMINDER_TZ = process.env.REMINDER_TZ || "America/Toronto";

let transport;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

const fmtMoney = (cents) =>
  `$${(cents / 100).toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Today's {year, month, day} in the reminder timezone. */
function todayInTz() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REMINDER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * The calendar date REMINDER_DAYS_AHEAD days from today (tz-anchored), plus
 * which due_days it matches: a due_day is due that day either exactly or by
 * month-end clamping (due_day 31 falls "on" Apr 30, same rule the Monthly
 * tab's upcoming list uses).
 */
function reminderTarget() {
  const t = todayInTz();
  const target = new Date(Date.UTC(t.year, t.month - 1, t.day + REMINDER_DAYS_AHEAD));
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + 1;
  const day = target.getUTCDate();
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const label = target.toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return {
    monthKey,
    label,
    matches: (dueDay) =>
      dueDay === day || (day === lastDayOfMonth && dueDay > lastDayOfMonth),
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.CRON_SECRET) {
    return res.status(503).json({ error: "CRON_SECRET isn't configured — reminders disabled." });
  }
  const auth = req.headers["authorization"] || "";
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized." });
  }

  const sql = getSql();
  if (!sql) {
    return res.status(503).json({ error: "The database isn't configured." });
  }
  if (!process.env.SMTP_HOST || !process.env.CONTACT_FROM) {
    return res.status(503).json({ error: "SMTP isn't configured." });
  }
  if (!process.env.CLERK_SECRET_KEY) {
    return res.status(503).json({ error: "Clerk isn't configured." });
  }

  const dryRun = String(req.query?.dryRun || "") === "1";

  try {
    await ensureTables(sql);
    const target = reminderTarget();

    // All users' active due-dated bills — cron runs for the whole app.
    const items = await sql`
      SELECT user_id, label, category, amount_cents, due_day, paid_from, on_card
        FROM budget_recurring
       WHERE due_day IS NOT NULL
         AND start_month <= ${target.monthKey}
         AND (end_month IS NULL OR end_month >= ${target.monthKey})
    `;

    const byUser = new Map();
    for (const item of items) {
      if (!target.matches(item.due_day)) continue;
      const list = byUser.get(item.user_id) || [];
      list.push(item);
      byUser.set(item.user_id, list);
    }

    if (byUser.size === 0) {
      return res.status(200).json({ ok: true, sent: 0, due: 0, target: target.label });
    }

    const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const results = [];

    for (const [userId, bills] of byUser) {
      let email = null;
      try {
        const user = await clerk.users.getUser(userId);
        email =
          user.primaryEmailAddress?.emailAddress ||
          user.emailAddresses?.[0]?.emailAddress ||
          null;
      } catch (err) {
        console.error(`Reminders: couldn't resolve user ${userId}:`, err.message);
      }
      if (!email) {
        results.push({ userId, sent: false, reason: "no email" });
        continue;
      }

      bills.sort((a, b) => b.amount_cents - a.amount_cents);
      const total = bills.reduce((s, b) => s + b.amount_cents, 0);
      const lines = bills.map(
        (b) =>
          `  • ${b.label} — ${fmtMoney(b.amount_cents)}` +
          (b.paid_from ? ` (from ${b.paid_from})` : b.on_card ? " (on your card)" : "")
      );
      const plural = bills.length === 1 ? "bill is" : `${bills.length} bills are`;
      const subject = `Budgetter: ${
        bills.length === 1 ? bills[0].label : `${bills.length} bills`
      } due ${target.label}`;
      const text = [
        `Heads up — the following ${plural} due on ${target.label}:`,
        "",
        ...lines,
        "",
        `Total: ${fmtMoney(total)}`,
        "",
        "— Budgetter · manage these in the Monthly tab",
      ].join("\n");

      if (dryRun) {
        results.push({ userId, sent: false, dryRun: true, subject, bills: bills.length });
        continue;
      }

      try {
        await getTransport().sendMail({
          from: process.env.CONTACT_FROM,
          to: email,
          subject,
          text,
        });
        results.push({ userId, sent: true, bills: bills.length });
      } catch (err) {
        console.error(`Reminders: send failed for ${userId}:`, err.message);
        results.push({ userId, sent: false, reason: "send failed" });
      }
    }

    return res.status(200).json({
      ok: true,
      target: target.label,
      due: items.length,
      sent: results.filter((r) => r.sent).length,
      results,
    });
  } catch (err) {
    console.error("Budget reminders error:", err);
    return res.status(500).json({ error: "Something went wrong." });
  }
};
