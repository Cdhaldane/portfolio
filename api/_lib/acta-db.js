// Schema + queries for Acta Diurna (/api/acta/*). Shares the Neon client with
// Budgetter, Bowler and Top 5 (same database, `acta_` table prefix so nothing
// can collide). NOT an endpoint.
//
//   acta_seasons  a five-week block of 30 topics: proposed → approved
//   acta_topics   one lesson-to-be; its position fixes its weekday
//   acta_lessons  one scheduled lesson, its pipeline status and the finished
//                 JSON the page renders (`data`), plus what it was written
//                 from (`sources`, never sent to visitors)
//   acta_flags    "this card is wrong" reports from readers
//   acta_users    Charlie's synced progress / review deck (signed-in only)
//   acta_push     daily-reminder push subscriptions
//   acta_meta     small key/value state: the pipeline lock, last push date
//
// Dates are TEXT "YYYY-MM-DD" in Toronto time (see acta-schedule.js), which
// sorts correctly and never gets shifted by a driver's timezone handling.
const { getSql } = require("./budget-db");
const { SEASON_ONE, SEED_LESSONS } = require("./acta-seed");

const LESSON_COLS = `id, topic_id, slug, day, publish_on, status, held, data, issues, batch_id,
  attempts, revisions, error, updated_at`;

let ensured = false;

async function ensureActaTables(sql) {
  if (ensured) return;
  // Idempotent, so two cold starts racing through this is harmless.
  await sql`
    CREATE TABLE IF NOT EXISTS acta_seasons (
      id          SERIAL PRIMARY KEY,
      number      INTEGER NOT NULL,
      title       TEXT NOT NULL,
      span        TEXT NOT NULL DEFAULT '',
      intro       TEXT NOT NULL DEFAULT '',
      themes      JSONB NOT NULL DEFAULT '[]'::jsonb,
      status      TEXT NOT NULL DEFAULT 'proposed',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      approved_at TIMESTAMPTZ
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS acta_topics (
      id          SERIAL PRIMARY KEY,
      season_id   INTEGER NOT NULL REFERENCES acta_seasons(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      kind        TEXT NOT NULL,
      title       TEXT NOT NULL,
      slug        TEXT NOT NULL DEFAULT '',
      era         TEXT NOT NULL,
      year        INTEGER NOT NULL DEFAULT 0,
      year_label  TEXT NOT NULL DEFAULT '',
      wiki        JSONB NOT NULL DEFAULT '[]'::jsonb,
      focus       TEXT NOT NULL DEFAULT '',
      warning     TEXT
    )`;
  await sql`CREATE INDEX IF NOT EXISTS acta_topics_season ON acta_topics (season_id, position)`;
  await sql`
    CREATE TABLE IF NOT EXISTS acta_lessons (
      id          SERIAL PRIMARY KEY,
      topic_id    INTEGER UNIQUE REFERENCES acta_topics(id) ON DELETE SET NULL,
      slug        TEXT NOT NULL UNIQUE,
      day         INTEGER,
      publish_on  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'queued',
      held        BOOLEAN NOT NULL DEFAULT false,
      data        JSONB,
      sources     JSONB,
      issues      JSONB NOT NULL DEFAULT '[]'::jsonb,
      batch_id    TEXT,
      attempts    INTEGER NOT NULL DEFAULT 0,
      revisions   INTEGER NOT NULL DEFAULT 0,
      error       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS acta_lessons_publish ON acta_lessons (publish_on)`;
  await sql`
    CREATE TABLE IF NOT EXISTS acta_flags (
      id          SERIAL PRIMARY KEY,
      slug        TEXT NOT NULL,
      card        INTEGER,
      reason      TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS acta_users (
      user_id     TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS acta_push (
      endpoint    TEXT PRIMARY KEY,
      keys        JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS acta_meta (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;

  // A fresh database starts with Season 1 waiting for approval.
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM acta_seasons`;
  if (n === 0) await insertSeason(sql, SEASON_ONE, "proposed");
  ensured = true;
}

// ---------------------------------------------------------------------------
// Seasons and topics

async function insertSeason(sql, season, status = "proposed") {
  const themes = (season.weeks || []).map((w) => w.theme || "");
  const [row] = await sql`
    INSERT INTO acta_seasons (number, title, span, intro, themes, status)
    VALUES (${season.number}, ${season.title}, ${season.span || ""}, ${season.intro || ""},
            ${JSON.stringify(themes)}::jsonb, ${status})
    RETURNING id`;
  const topics = (season.weeks || []).flatMap((w) => w.topics || []);
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    await sql`
      INSERT INTO acta_topics (season_id, position, kind, title, slug, era, year, year_label, wiki, focus, warning)
      VALUES (${row.id}, ${i}, ${t.kind}, ${t.title}, ${t.slug || ""}, ${t.era}, ${t.year || 0},
              ${t.yearLabel || ""}, ${JSON.stringify(t.wiki || [])}::jsonb, ${t.focus || ""}, ${t.warning || null})`;
  }
  return row.id;
}

const topicOut = (t) => ({
  id: t.id,
  seasonId: t.season_id,
  position: t.position,
  kind: t.kind,
  title: t.title,
  slug: t.slug,
  era: t.era,
  year: t.year,
  yearLabel: t.year_label,
  wiki: t.wiki || [],
  focus: t.focus,
  warning: t.warning || null,
});

async function listSeasons(sql) {
  const seasons = await sql`
    SELECT id, number, title, span, intro, themes, status, created_at, approved_at
      FROM acta_seasons WHERE status <> 'discarded' ORDER BY number, id`;
  const topics = await sql`
    SELECT t.* FROM acta_topics t JOIN acta_seasons s ON s.id = t.season_id
     WHERE s.status <> 'discarded' ORDER BY t.season_id, t.position`;
  return seasons.map((s) => ({
    id: s.id,
    number: s.number,
    title: s.title,
    span: s.span,
    intro: s.intro,
    themes: s.themes || [],
    status: s.status,
    approvedAt: s.approved_at,
    topics: topics.filter((t) => t.season_id === s.id).map(topicOut),
  }));
}

async function getSeason(sql, id) {
  const all = await listSeasons(sql);
  return all.find((s) => s.id === id) || null;
}

async function getTopic(sql, id) {
  const [t] = await sql`SELECT * FROM acta_topics WHERE id = ${id}`;
  return t ? topicOut(t) : null;
}

async function updateTopic(sql, id, f) {
  const [t] = await sql`
    UPDATE acta_topics SET
      title = ${f.title}, slug = ${f.slug || ""}, kind = ${f.kind}, era = ${f.era}, year = ${f.year},
      year_label = ${f.yearLabel}, wiki = ${JSON.stringify(f.wiki || [])}::jsonb, focus = ${f.focus},
      warning = ${f.warning || null}
    WHERE id = ${id} RETURNING *`;
  return t ? topicOut(t) : null;
}

/** Swap two topics' positions (and so their weekdays) inside one season. */
async function swapTopicPositions(sql, a, b) {
  await sql.transaction([
    sql`UPDATE acta_topics SET position = -1 - position WHERE id = ${a.id}`,
    sql`UPDATE acta_topics SET position = ${a.position} WHERE id = ${b.id}`,
    sql`UPDATE acta_topics SET position = ${b.position} WHERE id = ${a.id}`,
  ]);
}

async function setSeasonStatus(sql, id, status) {
  await sql`
    UPDATE acta_seasons SET status = ${status},
      approved_at = CASE WHEN ${status} = 'approved' THEN now() ELSE approved_at END
    WHERE id = ${id}`;
}

async function nextSeasonNumber(sql) {
  const [{ n }] = await sql`SELECT COALESCE(max(number), 0)::int AS n FROM acta_seasons WHERE status <> 'discarded'`;
  return n + 1;
}

async function pastTopicTitles(sql) {
  const rows = await sql`
    SELECT t.title FROM acta_topics t JOIN acta_seasons s ON s.id = t.season_id
     WHERE s.status <> 'discarded' ORDER BY t.season_id, t.position`;
  return rows.map((r) => r.title);
}

// ---------------------------------------------------------------------------
// Lessons

async function lastScheduledDate(sql) {
  const [r] = await sql`SELECT max(publish_on) AS d FROM acta_lessons`;
  return r && r.d ? r.d : null;
}

async function slugTaken(sql, slug) {
  const [r] = await sql`SELECT 1 AS x FROM acta_lessons WHERE slug = ${slug}`;
  return Boolean(r);
}

async function insertLesson(sql, l) {
  const [row] = await sql`
    INSERT INTO acta_lessons (topic_id, slug, publish_on, status, data, sources)
    VALUES (${l.topicId}, ${l.slug}, ${l.publishOn}, ${l.status || "queued"},
            ${l.data ? JSON.stringify(l.data) : null}::jsonb, ${l.sources ? JSON.stringify(l.sources) : null}::jsonb)
    RETURNING ${sql.unsafe(LESSON_COLS)}`;
  return row;
}

/** Day numbers follow the calendar: the earliest scheduled lesson is Day 1. */
async function renumberDays(sql) {
  await sql`
    UPDATE acta_lessons l SET day = r.n
      FROM (SELECT id, row_number() OVER (ORDER BY publish_on, id)::int AS n FROM acta_lessons) r
     WHERE r.id = l.id AND (l.day IS DISTINCT FROM r.n)`;
}

const UPDATABLE = {
  status: "text",
  held: "bool",
  data: "jsonb",
  sources: "jsonb",
  issues: "jsonb",
  batch_id: "text",
  attempts: "int",
  revisions: "int",
  error: "text",
  publish_on: "text",
};

/**
 * Update a lesson. With `expectStatus`, only when it is still in that status,
 * so a transition is never applied twice. Resolves with the row or null.
 */
async function updateLesson(sql, id, fields, { expectStatus } = {}) {
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    const type = UPDATABLE[k];
    if (!type) continue;
    params.push(type === "jsonb" ? (v == null ? null : JSON.stringify(v)) : v);
    sets.push(`${k} = $${params.length}${type === "jsonb" ? "::jsonb" : ""}`);
  }
  if (!sets.length) return null;
  params.push(id);
  let where = `id = $${params.length}`;
  if (expectStatus) {
    params.push(expectStatus);
    where += ` AND status = $${params.length}`;
  }
  const rows = await sql.query(
    `UPDATE acta_lessons SET ${sets.join(", ")}, updated_at = now() WHERE ${where} RETURNING ${LESSON_COLS}`,
    params
  );
  return rows[0] || null;
}

async function getLesson(sql, id, { withSources = false } = {}) {
  const rows = withSources
    ? await sql`SELECT ${sql.unsafe(LESSON_COLS)}, sources FROM acta_lessons WHERE id = ${id}`
    : await sql`SELECT ${sql.unsafe(LESSON_COLS)} FROM acta_lessons WHERE id = ${id}`;
  return rows[0] || null;
}

/** Every lesson with its topic, oldest first, without the bulky sources. */
async function listLessons(sql) {
  return sql`
    SELECT l.id, l.topic_id, l.slug, l.day, l.publish_on, l.status, l.held, l.issues, l.batch_id,
           l.attempts, l.revisions, l.error, l.updated_at,
           l.data->>'title' AS lesson_title,
           t.title AS topic_title, t.kind, t.era, t.year, t.year_label, t.wiki, t.focus, t.season_id
      FROM acta_lessons l LEFT JOIN acta_topics t ON t.id = l.topic_id
     ORDER BY l.publish_on, l.id`;
}

/** Lessons the pipeline still has work to do on. */
async function activeLessons(sql) {
  return sql`
    SELECT l.id, l.topic_id, l.slug, l.publish_on, l.status, l.batch_id, l.attempts, l.revisions,
           t.title AS topic_title, t.kind, t.era, t.year, t.year_label, t.wiki, t.focus
      FROM acta_lessons l LEFT JOIN acta_topics t ON t.id = l.topic_id
     WHERE l.status NOT IN ('ready', 'needs_review', 'failed')
     ORDER BY l.publish_on, l.id`;
}

const LIVE = `status = 'ready' AND NOT held AND data IS NOT NULL`;

/** The newest live lesson on or before `today`. */
async function latestLive(sql, today) {
  const rows = await sql.query(
    `SELECT ${LESSON_COLS} FROM acta_lessons WHERE ${LIVE} AND publish_on <= $1 ORDER BY publish_on DESC, id DESC LIMIT 1`,
    [today]
  );
  return rows[0] || null;
}

async function liveBySlug(sql, slug, today) {
  const rows = await sql.query(
    `SELECT ${LESSON_COLS} FROM acta_lessons WHERE ${LIVE} AND publish_on <= $1 AND slug = $2`,
    [today, slug]
  );
  return rows[0] || null;
}

async function lessonBySlug(sql, slug) {
  const rows = await sql`SELECT ${sql.unsafe(LESSON_COLS)} FROM acta_lessons WHERE slug = ${slug}`;
  return rows[0] || null;
}

/** Live lessons, newest first, as archive/timeline entries. */
async function archive(sql, today) {
  return sql.query(
    `SELECT slug, day, publish_on,
            data->>'title' AS title, data->>'subtitle' AS subtitle, data->>'summary' AS summary,
            data->>'kind' AS kind, data->>'era' AS era, (data->>'year')::int AS year,
            data->>'yearLabel' AS year_label, data->'takeaways' AS takeaways,
            (data->>'minutes')::int AS minutes
       FROM acta_lessons WHERE ${LIVE} AND publish_on <= $1
      ORDER BY publish_on DESC, id DESC LIMIT 2000`,
    [today]
  );
}

/** The next scheduled topic after `date` (for the close card's "tomorrow"). */
async function nextAfter(sql, date) {
  const [r] = await sql`
    SELECT l.slug, l.publish_on, t.title, t.kind
      FROM acta_lessons l JOIN acta_topics t ON t.id = l.topic_id
     WHERE l.publish_on > ${date} AND NOT l.held
     ORDER BY l.publish_on, l.id LIMIT 1`;
  return r ? { slug: r.slug, date: r.publish_on, title: r.title, kind: r.kind } : null;
}

/** The live lessons either side of `date`, for prev/next links. */
async function neighbours(sql, date, today) {
  const prev = await sql.query(
    `SELECT slug, data->>'title' AS title FROM acta_lessons WHERE ${LIVE} AND publish_on < $1 ORDER BY publish_on DESC LIMIT 1`,
    [date]
  );
  const next = await sql.query(
    `SELECT slug, data->>'title' AS title FROM acta_lessons WHERE ${LIVE} AND publish_on > $1 AND publish_on <= $2 ORDER BY publish_on LIMIT 1`,
    [date, today]
  );
  return { prev: prev[0] || null, next: next[0] || null };
}

/** Scheduled lessons from `from` onwards (inclusive), for "how much runway is left". */
async function scheduledFrom(sql, from) {
  const [r] = await sql`SELECT count(*)::int AS n FROM acta_lessons WHERE publish_on >= ${from} AND NOT held`;
  return r.n;
}

async function topicsByIds(sql, ids) {
  if (!ids.length) return [];
  const rows = await sql`SELECT * FROM acta_topics WHERE id = ANY(${ids})`;
  return rows.map(topicOut);
}

// ---------------------------------------------------------------------------
// Flags, users, push, meta

async function insertFlag(sql, f) {
  const [r] = await sql`
    INSERT INTO acta_flags (slug, card, reason, note) VALUES (${f.slug}, ${f.card}, ${f.reason}, ${f.note || ""})
    RETURNING id`;
  return r.id;
}

async function listFlags(sql) {
  return sql`SELECT id, slug, card, reason, note, status, created_at FROM acta_flags
              ORDER BY (status = 'open') DESC, created_at DESC LIMIT 200`;
}

async function setFlagStatus(sql, id, status) {
  await sql`UPDATE acta_flags SET status = ${status} WHERE id = ${id}`;
}

async function openFlagCards(sql, slug) {
  const rows = await sql`SELECT DISTINCT card FROM acta_flags WHERE slug = ${slug} AND status = 'open' AND card IS NOT NULL`;
  return rows.map((r) => r.card);
}

async function getUserData(sql, userId) {
  const [r] = await sql`SELECT data FROM acta_users WHERE user_id = ${userId}`;
  return r ? r.data : null;
}

async function putUserData(sql, userId, data) {
  await sql`
    INSERT INTO acta_users (user_id, data) VALUES (${userId}, ${JSON.stringify(data)}::jsonb)
    ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}

async function savePush(sql, sub) {
  await sql`
    INSERT INTO acta_push (endpoint, keys) VALUES (${sub.endpoint}, ${JSON.stringify(sub.keys)}::jsonb)
    ON CONFLICT (endpoint) DO UPDATE SET keys = EXCLUDED.keys`;
}

async function deletePush(sql, endpoint) {
  await sql`DELETE FROM acta_push WHERE endpoint = ${endpoint}`;
}

async function listPush(sql) {
  return sql`SELECT endpoint, keys FROM acta_push`;
}

async function getMeta(sql, key) {
  const [r] = await sql`SELECT value FROM acta_meta WHERE key = ${key}`;
  return r ? r.value : null;
}

async function setMeta(sql, key, value) {
  await sql`
    INSERT INTO acta_meta (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/**
 * Take a named lock for `ttlMs`. Resolves true when taken. A crashed holder's
 * lock simply expires, so nothing ever has to clear it by hand.
 */
async function takeLock(sql, name, ttlMs) {
  const key = `lock:${name}`;
  const until = new Date(Date.now() + ttlMs).toISOString();
  const now = new Date().toISOString();
  const rows = await sql`
    INSERT INTO acta_meta (key, value) VALUES (${key}, ${until})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      WHERE acta_meta.value IS NULL OR acta_meta.value < ${now}
    RETURNING key`;
  return rows.length > 0;
}

async function releaseLock(sql, name) {
  await sql`UPDATE acta_meta SET value = NULL WHERE key = ${`lock:${name}`}`;
}

/** Everything the pipeline and handler need, bound to one connection. */
function createStore(sql) {
  const bind = (fn) => (...args) => fn(sql, ...args);
  return {
    ensure: () => ensureActaTables(sql),
    insertSeason: bind(insertSeason),
    listSeasons: bind(listSeasons),
    getSeason: bind(getSeason),
    getTopic: bind(getTopic),
    updateTopic: bind(updateTopic),
    swapTopicPositions: bind(swapTopicPositions),
    setSeasonStatus: bind(setSeasonStatus),
    nextSeasonNumber: bind(nextSeasonNumber),
    pastTopicTitles: bind(pastTopicTitles),
    lastScheduledDate: bind(lastScheduledDate),
    slugTaken: bind(slugTaken),
    insertLesson: bind(insertLesson),
    renumberDays: bind(renumberDays),
    updateLesson: bind(updateLesson),
    getLesson: bind(getLesson),
    listLessons: bind(listLessons),
    activeLessons: bind(activeLessons),
    latestLive: bind(latestLive),
    liveBySlug: bind(liveBySlug),
    lessonBySlug: bind(lessonBySlug),
    archive: bind(archive),
    nextAfter: bind(nextAfter),
    neighbours: bind(neighbours),
    scheduledFrom: bind(scheduledFrom),
    topicsByIds: bind(topicsByIds),
    insertFlag: bind(insertFlag),
    listFlags: bind(listFlags),
    setFlagStatus: bind(setFlagStatus),
    openFlagCards: bind(openFlagCards),
    getUserData: bind(getUserData),
    putUserData: bind(putUserData),
    savePush: bind(savePush),
    deletePush: bind(deletePush),
    listPush: bind(listPush),
    getMeta: bind(getMeta),
    setMeta: bind(setMeta),
    takeLock: bind(takeLock),
    releaseLock: bind(releaseLock),
    seedLesson: (slug) => SEED_LESSONS[slug] || null,
  };
}

module.exports = { getSql, ensureActaTables, createStore };
