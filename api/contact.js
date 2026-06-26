// Vercel serverless function — POST /api/contact
// Sends the contact form through a dedicated SMTP provider (Brevo, Mailgun,
// SES, etc.) using credentials kept in Vercel env vars. No OAuth to expire.
const nodemailer = require("nodemailer");

// Reuse the transport across warm invocations instead of rebuilding per request.
let transport;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // implicit TLS on 465, STARTTLS on 587
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Vercel's Node runtime parses JSON bodies automatically.
  const { user_name, user_email, message, company } = req.body || {};

  // Honeypot: real users never fill a hidden "company" field — bots do.
  if (company) return res.status(200).json({ ok: true });

  if (!user_name || !user_email || !message) {
    return res.status(400).json({ error: "All fields are required" });
  }
  if (!isEmail(user_email)) {
    return res.status(400).json({ error: "Please enter a valid email" });
  }
  if (message.length > 5000) {
    return res.status(400).json({ error: "Message is too long" });
  }

  if (!process.env.SMTP_HOST || !process.env.CONTACT_TO) {
    console.error("Mail not configured: missing SMTP_HOST / CONTACT_TO env vars");
    return res.status(500).json({ error: "Mail service not configured" });
  }

  try {
    await getTransport().sendMail({
      from: process.env.CONTACT_FROM || process.env.SMTP_USER,
      to: process.env.CONTACT_TO,
      replyTo: `${user_name} <${user_email}>`, // reply goes straight to the sender
      subject: `Portfolio enquiry from ${user_name}`,
      text: `${message}\n\n— ${user_name} <${user_email}>`,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Mail send failed:", err);
    return res.status(502).json({ error: "Could not send message" });
  }
};
