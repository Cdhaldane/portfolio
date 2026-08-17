// Vercel serverless function — ALL /api/game/* routes.
//
// One dynamic function, same reasoning as api/budget/[action].js: the Hobby plan caps
// a deployment at 12 serverless functions and counts FILES under api/, not routes.
// This takes the deployment to 6. The handler lives under api/_lib/handlers/, whose
// underscore prefix keeps Vercel from bundling it as a function of its own.
//
//   GET  /api/game/board            the top runs
//   GET  /api/game/replay?player=…  one run's replay, to recompute it
//   POST /api/game/submit           bank a finished run
module.exports = require("../_lib/handlers/hymn.js");
