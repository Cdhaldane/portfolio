// Vercel serverless function — /api/jeopardy (JEOPARDRINK! phone buzzers).
//
// One function, every op (?op=create|state|poll|join|buzz|final). The rules
// live in _lib/jeopardy-handler.js (unit-tested with fakes); this file only
// wires in the real database. The Hobby plan caps a deployment at 12
// functions; this is the 11th.
const db = require("./_lib/jeopardy-db");
const { createJeopardyHandler } = require("./_lib/jeopardy-handler");

module.exports = createJeopardyHandler({
  getSql: db.getSql,
  db: {
    ensureTables: db.ensureJeopardyTables,
    purgeOldRooms: db.purgeOldRooms,
    createRoom: db.createRoom,
    getSnapshot: db.getSnapshot,
    getPlayer: db.getPlayer,
    saveState: db.saveState,
    addPlayer: db.addPlayer,
    insertBuzz: db.insertBuzz,
    listBuzzes: db.listBuzzes,
    upsertFinal: db.upsertFinal,
  },
});
