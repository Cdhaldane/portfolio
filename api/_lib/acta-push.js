// Daily reminder notifications for Acta Diurna (Web Push). NOT an endpoint.
//
// Readers opt in from the page's menu; the browser hands us a push
// subscription, stored in acta_push. The daily cron calls sendDaily(), which
// sends one notification per subscription on days a new lesson goes live,
// and a review nudge on Sundays. Hobby-plan crons run once a day, so the
// reminder arrives at the cron's time (early morning, Toronto), not a time
// each reader picks.
//
// Env (all three, or push is off and the menu hides the option):
//   ACTA_VAPID_PUBLIC_KEY / ACTA_VAPID_PRIVATE_KEY
//     generate once: npx web-push generate-vapid-keys
//   ACTA_VAPID_SUBJECT  a mailto: or https: contact (defaults to the site URL)
const { isReviewDay } = require("./acta-schedule");

const configured = () => Boolean(process.env.ACTA_VAPID_PUBLIC_KEY && process.env.ACTA_VAPID_PRIVATE_KEY);
const publicKey = () => process.env.ACTA_VAPID_PUBLIC_KEY || null;

/** A subscription as the browser serialises it, or null if it isn't one. */
function validSubscription(sub) {
  if (!sub || typeof sub !== "object") return null;
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint.trim() : "";
  const keys = sub.keys && typeof sub.keys === "object" ? sub.keys : {};
  if (!/^https:\/\/[^\s]{8,}$/.test(endpoint) || endpoint.length > 1000) return null;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** What today's notification says, or null when there's nothing new. */
function payloadFor(today, row) {
  if (isReviewDay(today)) {
    return { title: "Acta Diurna · Review day", body: "No new lesson today. Ten minutes on this week's questions.", url: "/acta/review" };
  }
  if (!row || row.publish_on !== today || !row.data) return null;
  return {
    title: `Acta Diurna · Day ${row.day}`,
    body: row.data.summary ? `${row.data.title}. ${row.data.summary}` : row.data.title,
    url: "/acta",
  };
}

/**
 * Send today's notification to every subscriber, once per day. Gone
 * subscriptions (404/410) are deleted. `sender` is injectable for tests.
 */
async function sendDaily(store, { today, row, sender } = {}) {
  if (!configured() && !sender) return { sent: 0, skipped: "push is not configured" };
  if ((await store.getMeta("push:last")) === today) return { sent: 0, skipped: "already sent today" };
  const payload = payloadFor(today, row);
  if (!payload) return { sent: 0, skipped: "no new lesson today" };
  // Mark first: a crash mid-send must not mean a second round tomorrow-same-day.
  await store.setMeta("push:last", today);

  let send = sender;
  if (!send) {
    const webpush = require("web-push");
    webpush.setVapidDetails(
      process.env.ACTA_VAPID_SUBJECT || "https://charliehaldane.ca/acta",
      process.env.ACTA_VAPID_PUBLIC_KEY,
      process.env.ACTA_VAPID_PRIVATE_KEY
    );
    send = (sub, body) => webpush.sendNotification(sub, body, { TTL: 12 * 60 * 60 });
  }

  let sent = 0;
  let removed = 0;
  for (const s of await store.listPush()) {
    try {
      await send({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload));
      sent += 1;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) {
        await store.deletePush(s.endpoint);
        removed += 1;
      }
    }
  }
  return { sent, removed };
}

module.exports = { configured, publicKey, validSubscription, payloadFor, sendDaily };
