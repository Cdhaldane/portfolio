// Vercel serverless function — ALL /api/acta/* routes (Acta Diurna, /acta).
//
// One dynamic function, not one per route: the Hobby plan caps a deployment
// at 12 functions and counts files under api/. The rules live in
// _lib/acta-handler.js (unit-tested with fakes); this file only wires in the
// real auth, database, Claude, Wikimedia and push. /api/acta/today arrives
// here with req.query.action === "today".
const { requireUser, sendAuthError, HttpError } = require("../_lib/budget-auth");
const { getSql, createStore } = require("../_lib/acta-db");
const { createPipeline } = require("../_lib/acta-pipeline");
const { createActaHandler } = require("../_lib/acta-handler");
const claude = require("../_lib/acta-claude");
const sources = require("../_lib/acta-sources");
const push = require("../_lib/acta-push");

module.exports = createActaHandler({
  requireUser,
  sendAuthError,
  HttpError,
  getSql,
  createStore,
  createPipeline,
  claude,
  sources,
  push,
});
