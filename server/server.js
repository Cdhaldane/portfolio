// server.js
const express = require("express");
const cors = require("cors");
const userRoutes = require("./routes/user.routes");

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

// Middleware
app.use(express.json());

// Routes
app.use("/api", userRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
