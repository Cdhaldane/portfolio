// Vercel serverless function — /api/top5 (the Top 5 Things card set).
//
//   GET                    → every saved pack edit (public; the page merges
//                            them over its built-in defaults)
//   GET ?me=1              → { canEdit } for the signed-in owner
//   PUT { packId, pack }   → save one pack's edits (owner only)
//   DELETE ?packId=movies  → reset one pack to its defaults (owner only)
//
// Owner = a verified Clerk session on the fail-closed TOP5_EDITOR_USER_IDS
// allowlist. The rules live in _lib/top5-handler.js (unit-tested with fakes);
// this file only wires in the real auth and database. One file, one
// function: the Hobby plan caps a deployment at 12.
const { requireUser, sendAuthError, HttpError } = require("./_lib/budget-auth");
const { getSql, ensureTop5Table, listPacks, savePack, deletePack } = require("./_lib/top5-db");
const { createTop5Handler } = require("./_lib/top5-handler");

module.exports = createTop5Handler({
  requireUser,
  sendAuthError,
  HttpError,
  getSql,
  ensureTable: ensureTop5Table,
  listPacks,
  savePack,
  deletePack,
});
