// Vercel serverless function — gate for the hidden /dashboard.
//
//   GET  /api/dashboard-access   → is this visitor's IP on the allowlist?
//                                   { granted, method: "ip" | "password", ip }
//   POST /api/dashboard-access   → body { password } checked against the secret.
//                                   { granted } (401 on a wrong password)
//
// The password and the allowed-IP list live in env vars, so neither ships in
// the client bundle. Config (set in .env.local for `vercel dev`, and in the
// Vercel dashboard for prod):
//   DASHBOARD_PASSWORD     defaults to "cat" if unset
//   DASHBOARD_ALLOWED_IPS  comma-separated allowlist, e.g. "203.0.113.5, 2001:db8::1"

// Normalise so "::ffff:203.0.113.5" and "203.0.113.5" compare equal, and trim.
const normalizeIp = (ip) => (ip || "").trim().replace(/^::ffff:/, "");

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return normalizeIp(String(xff).split(",")[0]);
  return normalizeIp(req.socket && req.socket.remoteAddress);
}

function isAllowedIp(ip) {
  if (!ip) return false;
  const list = (process.env.DASHBOARD_ALLOWED_IPS || "")
    .split(",")
    .map(normalizeIp)
    .filter(Boolean);
  return list.includes(ip);
}

module.exports = async (req, res) => {
  const ip = getClientIp(req);

  if (req.method === "GET") {
    if (isAllowedIp(ip)) {
      return res.status(200).json({ granted: true, method: "ip", ip });
    }
    // Echo the detected IP back so you can copy it into DASHBOARD_ALLOWED_IPS.
    return res.status(200).json({ granted: false, method: "password", ip });
  }

  if (req.method === "POST") {
    // A trusted IP never needs the password.
    if (isAllowedIp(ip)) {
      return res.status(200).json({ granted: true, method: "ip", ip });
    }
    const expected = process.env.DASHBOARD_PASSWORD || "cat";
    const { password } = req.body || {};
    if (typeof password === "string" && password === expected) {
      return res.status(200).json({ granted: true, method: "password" });
    }
    return res.status(401).json({ granted: false });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
};
