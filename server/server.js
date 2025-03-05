// server.js
const express = require("express");
const cors = require("cors");
const userRoutes = require("./routes/user.routes");

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors());

// Middleware
app.use(express.json());

// Routes
app.use("/api", userRoutes);

// Sanitize database URL
function sanitizeDatabaseUrl(url) {
  if (!url) return "Not provided";
  return url.replace(/\/\/[^:]+:[^@]+@/, "//USER:PASSWORD@");
}

// Start server
app.listen(PORT, () => {
  console.log(
    `Server is running on port ${PORT}\n` +
      `Connected to database: ${process.env.PSQL_DB_NAME}\n` +
      `Database URL: ${sanitizeDatabaseUrl(process.env.PSQL_DATABASE_URL)}`
  );
});
