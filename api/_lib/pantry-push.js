// Pantry reminders over Web Push. NOT an endpoint.
//
// Two kinds:
//   - the daily digest (the cron), only for what's newly out, low, due or
//     about to go off since the last one (digestFor in pantry-stock.js);
//   - a heads-up to everyone else the moment someone marks a thing out or
//     low, so whoever passes a store can grab it.
//
// Env: PANTRY_VAPID_PUBLIC_KEY / PANTRY_VAPID_PRIVATE_KEY, falling back to
// Acta's ACTA_VAPID_* pair so one set of keys can serve the whole site.
// Generate once with: npx web-push generate-vapid-keys
const { validSubscription } = require("./acta-push");

const vapid = () => ({
  publicKey: process.env.PANTRY_VAPID_PUBLIC_KEY || process.env.ACTA_VAPID_PUBLIC_KEY || null,
  privateKey: process.env.PANTRY_VAPID_PRIVATE_KEY || process.env.ACTA_VAPID_PRIVATE_KEY || null,
  subject:
    process.env.PANTRY_VAPID_SUBJECT || process.env.ACTA_VAPID_SUBJECT || "https://charliehaldane.ca/pantry",
});

const configured = () => Boolean(vapid().publicKey && vapid().privateKey);
const publicKey = () => vapid().publicKey;

function defaultSender() {
  const webpush = require("web-push");
  const { publicKey: pub, privateKey, subject } = vapid();
  webpush.setVapidDetails(subject, pub, privateKey);
  return (sub, body) => webpush.sendNotification(sub, body, { TTL: 12 * 60 * 60 });
}

/**
 * Send one payload to each subscription. Gone subscriptions (404/410) are
 * removed through `drop`. `sender` is injectable for tests.
 */
async function sendAll(subs, payload, { drop, sender } = {}) {
  if (!subs.length || (!configured() && !sender)) return { sent: 0, removed: 0 };
  const send = sender || defaultSender();
  // The shared app worker (public/app-sw.js) shows whatever icon we name.
  const body = JSON.stringify({ icon: "/pantry-icon-192.png", badge: "/pantry-badge-96.png", ...payload });
  let sent = 0;
  let removed = 0;
  for (const s of subs) {
    try {
      await send({ endpoint: s.endpoint, keys: s.keys }, body);
      sent += 1;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410) && drop) {
        await drop(s.endpoint);
        removed += 1;
      }
    }
  }
  return { sent, removed };
}

/** The heads-up for someone else marking an item out or low. */
function markedPayload(item, op) {
  const verb = op === "out" ? "is out" : "is running low";
  return {
    title: `${item.name} ${verb}`,
    body: "It's on the shopping list.",
    url: "/pantry?tab=list",
    tag: `pantry-item-${item.id}`,
  };
}

module.exports = { configured, publicKey, validSubscription, sendAll, markedPayload };
