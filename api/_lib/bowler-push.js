// Bowler's league-night reminder over Web Push. NOT an endpoint.
//
// Env: BOWLER_VAPID_PUBLIC_KEY / BOWLER_VAPID_PRIVATE_KEY, falling back to
// Pantry's and then Acta's pair, so one set of keys can serve the whole
// site. Generate once with: npx web-push generate-vapid-keys
// The shared home-screen worker (public/app-sw.js) shows the payload.
const { validSubscription } = require("./acta-push");

const pick = (suffix) =>
  process.env[`BOWLER_VAPID_${suffix}`] ||
  process.env[`PANTRY_VAPID_${suffix}`] ||
  process.env[`ACTA_VAPID_${suffix}`] ||
  null;

const vapid = () => ({
  publicKey: pick("PUBLIC_KEY"),
  privateKey: pick("PRIVATE_KEY"),
  subject: pick("SUBJECT") || "https://charliehaldane.ca/bowler",
});

const configured = () => Boolean(vapid().publicKey && vapid().privateKey);
const publicKey = () => vapid().publicKey;

function defaultSender() {
  const webpush = require("web-push");
  const { publicKey: pub, privateKey, subject } = vapid();
  webpush.setVapidDetails(subject, pub, privateKey);
  // A league-night nudge is stale by morning.
  return (sub, body) => webpush.sendNotification(sub, body, { TTL: 8 * 60 * 60 });
}

/**
 * Send one payload to each subscription. Gone subscriptions (404/410) are
 * removed through `drop`. `sender` is injectable for tests.
 */
async function sendAll(subs, payload, { drop, sender } = {}) {
  if (!subs.length || (!configured() && !sender)) return { sent: 0, removed: 0 };
  const send = sender || defaultSender();
  const body = JSON.stringify({ icon: "/bowler-icon-192.png", ...payload });
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

module.exports = { configured, publicKey, validSubscription, sendAll };
