// Vercel serverless function — POST /api/inquiry
//
// Receives project inquiries from the contact / inquiry forms. If a Postgres
// connection string is configured (POSTGRES_URL), the inquiry is persisted to
// an `inquiries` table (created on first use). With no database configured it
// still validates and accepts the submission so the form works out of the box.
//
// Deploy: this file runs automatically as a serverless function on Vercel.
// Set POSTGRES_URL in your Vercel project's Environment Variables to enable
// persistence (Vercel Postgres / Neon both provide one).

const { Pool } = require("pg");

// Reuse the pool across warm invocations.
let pool;
function getPool() {
  if (!process.env.POSTGRES_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }
  return pool;
}

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function persist({ name, email, message }) {
  const db = getPool();
  if (!db) return false;

  await db.query(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(
    "INSERT INTO inquiries (name, email, message) VALUES ($1, $2, $3)",
    [name, email, message]
  );
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const name = (body.name || "").trim();
    const email = (body.email || "").trim();
    const message = (body.message || body.projectDetails || "").trim();

    if (!name || !email || !message) {
      return res.status(400).json({ error: "All fields are required." });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ error: "Please provide a valid email." });
    }

    const stored = await persist({ name, email, message });

    return res.status(200).json({
      ok: true,
      stored,
      message: "Thanks! Your inquiry has been received.",
    });
  } catch (error) {
    console.error("Inquiry error:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};
