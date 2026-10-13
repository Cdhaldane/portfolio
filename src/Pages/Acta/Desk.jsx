import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { SignIn } from "@clerk/clerk-react";
import Feed from "./Feed";
import { deskLoad, deskOp } from "./api";
import { setOwnerDevice, useShell } from "./shell";
import { KIND_LABEL } from "./lessonUtil";

/*
 * Charlie's desk: approve the seasons Claude proposes, watch lessons move
 * through the pipeline, preview them, and deal with reader flags. Lazy-loaded
 * with Clerk; the API re-checks the session and ACTA_EDITOR_USER_IDS on every
 * call, so this page only decides what to show.
 */

const STATUS = {
  queued: ["Queued", "wait", "·"],
  gathered: ["Sources in", "work", "◌"],
  researching: ["Researching", "work", "◌"],
  researched: ["Researched", "work", "◌"],
  writing: ["Writing", "work", "◌"],
  written: ["Drafted", "work", "◌"],
  checking: ["Fact-checking", "work", "◌"],
  revising: ["Rewriting", "work", "◌"],
  ready: ["Ready", "ok", "✓"],
  needs_review: ["Needs you", "warn", "!"],
  failed: ["Failed", "bad", "✕"],
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const fmt = (iso) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "";

function Pill({ status, held }) {
  const [label, tone, glyph] = STATUS[status] || [status, "wait", "·"];
  return (
    <span className={`ac-pill is-${held ? "wait" : tone}`}>
      <span aria-hidden="true">{held ? "‖" : glyph}</span> {held ? "Held" : label}
    </span>
  );
}

/** A destructive button that needs a second tap within a few seconds. */
function Confirm({ children, onConfirm, disabled, className = "ac-btn" }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`${className}${armed ? " is-armed" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          clearTimeout(timer.current);
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3500);
        }
      }}
    >
      {armed ? "Tap again to confirm" : children}
    </button>
  );
}

function DeskShell({ children, owner }) {
  return (
    <div className="ac-page ac-desk">
      <Helmet>
        <title>Acta Diurna · Desk</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <nav className="ac-pnav" aria-label="Acta">
        <Link to="/acta">Today</Link>
        <Link to="/acta/archive">Archive</Link>
        <span className="is-on">Desk</span>
        {owner && owner.signedIn ? (
          <button type="button" className="ac-link" onClick={() => owner.signOut({ redirectUrl: "/acta" })}>
            Sign out
          </button>
        ) : null}
      </nav>
      <header className="ac-page-head">
        <p className="ac-label">Charlie only</p>
        <h1 className="ac-page-title">The desk</h1>
      </header>
      {children}
    </div>
  );
}

export default function Desk() {
  const { owner } = useShell();
  if (!process.env.REACT_APP_CLERK_PUBLISHABLE_KEY) {
    return (
      <DeskShell>
        <p className="ac-note">
          Sign-in isn't configured on this build. Set <code>REACT_APP_CLERK_PUBLISHABLE_KEY</code> and rebuild.
        </p>
      </DeskShell>
    );
  }
  if (!owner || !owner.loaded) {
    return (
      <DeskShell owner={owner}>
        <p className="ac-note">Checking who you are…</p>
      </DeskShell>
    );
  }
  if (!owner.signedIn) {
    return (
      <DeskShell owner={owner}>
        <div className="ac-clerk">
          <SignIn routing="hash" forceRedirectUrl="/acta/desk" />
        </div>
      </DeskShell>
    );
  }
  return <DeskApp owner={owner} />;
}

function DeskApp({ owner }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState(null);
  const [preview, setPreview] = useState(null);
  const [auto, setAuto] = useState(false);
  const [tab, setTab] = useState("lessons");

  const load = useCallback(async () => {
    const r = await deskLoad(owner.getToken);
    if (r.ok) {
      setData(r);
      setError(null);
      setOwnerDevice(true);
    } else setError(r);
  }, [owner.getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const run = useCallback(
    async (body, label = body.op) => {
      setBusy(label);
      const r = await deskOp(owner.getToken, body);
      setBusy("");
      if (!r.ok) {
        setLog({ error: r.error });
        return r;
      }
      if (body.op === "preview") {
        setPreview(r);
        return r;
      }
      if (body.op === "advance") setLog({ steps: r.steps || [], busy: r.busy, outOfTime: r.outOfTime, stopped: r.stopped });
      else if (body.op === "approve") setLog({ note: `Season scheduled. First lesson ${fmt(r.start)}.` });
      else if (body.op === "propose") setLog({ note: `Claude proposed “${r.season && r.season.title}”. Review it below.` });
      else setLog(null);
      await load();
      return r;
    },
    [owner.getToken, load]
  );

  // While "keep running" is on, nudge the pipeline every 30 seconds.
  useEffect(() => {
    if (!auto) return undefined;
    let stop = false;
    let t = 0;
    const tick = async () => {
      if (stop) return;
      await run({ op: "advance" }, "advance");
      if (!stop) t = setTimeout(tick, 30000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [auto, run]);

  if (error && error.status === 403) {
    return (
      <DeskShell owner={owner}>
        <div className="ac-card-plain">
          <p>
            <b>This desk is Charlie's.</b>
          </p>
          {error.userId ? (
            <p className="ac-note">
              Signed in as <code>{error.userId}</code>. If that's you, add it to <code>ACTA_EDITOR_USER_IDS</code> in Vercel and redeploy.
            </p>
          ) : null}
        </div>
      </DeskShell>
    );
  }
  if (error) {
    return (
      <DeskShell owner={owner}>
        <p className="ac-error">{error.error}</p>
        <button type="button" className="ac-btn" onClick={load}>
          Try again
        </button>
      </DeskShell>
    );
  }
  if (!data) {
    return (
      <DeskShell owner={owner}>
        <p className="ac-note">Loading the desk…</p>
      </DeskShell>
    );
  }

  const proposed = data.seasons.filter((s) => s.status === "proposed");
  const needYou = data.lessons.filter((l) => l.status === "needs_review" || l.status === "failed");
  const openFlags = data.flags.filter((f) => f.status === "open");
  const lastDate = data.lessons.length ? data.lessons[data.lessons.length - 1].publishOn : null;

  return (
    <DeskShell owner={owner}>
      <section className="ac-desk-status" aria-label="Setup">
        <span className={`ac-pill is-${data.config.claude ? "ok" : "bad"}`}>{data.config.claude ? `✓ Claude · ${data.config.model}` : "✕ ANTHROPIC_API_KEY not set"}</span>
        <span className={`ac-pill is-${data.config.cron ? "ok" : "warn"}`}>{data.config.cron ? "✓ Daily cron" : "! CRON_SECRET not set"}</span>
        <span className={`ac-pill is-${data.config.push ? "ok" : "wait"}`}>{data.config.push ? "✓ Reminders" : "· Reminders off (no VAPID keys)"}</span>
        <span className="ac-pill is-wait">Calendar to {lastDate ? fmt(lastDate) : "—"}</span>
      </section>

      <ul className="ac-desk-todo">
        {proposed.length ? <li>Approve “{proposed[0].title}” to put it on the calendar.</li> : null}
        {needYou.length ? <li>{needYou.length} {needYou.length === 1 ? "lesson needs" : "lessons need"} you.</li> : null}
        {openFlags.length ? <li>{openFlags.length} reader {openFlags.length === 1 ? "flag" : "flags"} to look at.</li> : null}
        {!proposed.length && !needYou.length && !openFlags.length ? <li>Nothing needs you. The cron keeps a week of lessons ready.</li> : null}
      </ul>

      <div className="ac-desk-run">
        <button type="button" className="ac-btn is-solid" disabled={Boolean(busy)} onClick={() => run({ op: "advance" }, "advance")}>
          {busy === "advance" ? "Running…" : "Run the pipeline now"}
        </button>
        <label className="ac-check">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Keep running while this page is open
        </label>
      </div>

      {log ? <RunLog log={log} onClose={() => setLog(null)} /> : null}

      <div className="ac-tabs" role="tablist" aria-label="Desk sections">
        {[
          ["lessons", `Lessons · ${data.lessons.length}`],
          ["seasons", `Seasons${proposed.length ? ` · ${proposed.length} to approve` : ""}`],
          ["flags", `Flags${openFlags.length ? ` · ${openFlags.length}` : ""}`],
        ].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "lessons" ? <Lessons lessons={data.lessons} today={data.today} run={run} busy={busy} /> : null}
      {tab === "seasons" ? <Seasons seasons={data.seasons} run={run} busy={busy} /> : null}
      {tab === "flags" ? <Flags flags={data.flags} lessons={data.lessons} run={run} busy={busy} /> : null}

      {preview ? <Preview preview={preview} onClose={() => setPreview(null)} /> : null}
    </DeskShell>
  );
}

function RunLog({ log, onClose }) {
  return (
    <div className="ac-runlog" role="status">
      <button type="button" className="ac-x" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
      {log.error ? <p className="ac-error">{log.error}</p> : null}
      {log.note ? <p>{log.note}</p> : null}
      {log.busy ? <p>Another run is already going. Try again in a minute.</p> : null}
      {log.stopped ? <p>Stopped: Claude isn't configured.</p> : null}
      {log.steps ? (
        log.steps.length ? (
          <ul>
            {log.steps.map((s, i) => (
              <li key={i}>
                <code>{s.slug}</code> {s.from}
                {s.to ? ` → ${s.to}` : ""}
                {s.wait ? ` · ${s.wait}` : ""}
                {s.note ? ` · ${s.note}` : ""}
                {s.error ? <span className="ac-error"> · {s.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing to do right now.</p>
        )
      ) : null}
      {log.outOfTime ? <p className="ac-note">Ran out of time; the next run carries on.</p> : null}
    </div>
  );
}

function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Lessons({ lessons, today, run, busy }) {
  const [filter, setFilter] = useState("upcoming");
  const [open, setOpen] = useState(null);
  const shown = useMemo(() => {
    if (filter === "all") return lessons;
    if (filter === "attention") return lessons.filter((l) => ["needs_review", "failed"].includes(l.status) || l.error || l.held);
    return lessons.filter((l) => l.publishOn >= addDays(today, -6));
  }, [filter, lessons, today]);

  if (!lessons.length) return <p className="ac-note">No lessons scheduled yet. Approve a season under Seasons.</p>;
  return (
    <section>
      <div className="ac-seg" role="group" aria-label="Show">
        {[
          ["upcoming", "This week on"],
          ["attention", "Needs attention"],
          ["all", "All"],
        ].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ac-table-wrap">
        <table className="ac-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Day</th>
              <th scope="col">Lesson</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="ac-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <LessonRow key={l.id} l={l} today={today} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} run={run} busy={busy} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LessonRow({ l, today, open, onToggle, run, busy }) {
  const [notes, setNotes] = useState("");
  const errors = (l.issues || []).filter((i) => i.severity === "error").length;
  const live = l.status === "ready" && !l.held && l.publishOn <= today;
  const parseNotes = () =>
    notes
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d+)\s*[:.)-]\s*(.+)$/);
        return m ? { card: Number(m[1]), problem: m[2] } : { card: null, problem: line };
      });
  return (
    <>
      <tr className={l.publishOn === today ? "is-today" : ""}>
        <td className="ac-mono">{fmt(l.publishOn)}</td>
        <td className="ac-mono">{l.day}</td>
        <td>
          <b>{l.title}</b>
          <span className="ac-sub">
            {KIND_LABEL[l.kind] || l.kind} · {l.yearLabel}
            {live ? (
              <>
                {" "}
                ·{" "}
                <Link to={`/acta/${l.slug}`} target="_blank">
                  live
                </Link>
              </>
            ) : null}
          </span>
        </td>
        <td>
          <Pill status={l.status} held={l.held} />
          {errors ? <span className="ac-sub">{errors} to fix</span> : null}
          {l.error ? <span className="ac-sub ac-error">{l.error.slice(0, 90)}</span> : null}
        </td>
        <td className="ac-row-actions">
          <button type="button" className="ac-btn ac-btn--sm" aria-expanded={open} onClick={onToggle}>
            {open ? "Less" : "More"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="ac-row-detail">
          <td colSpan={5}>
            <div className="ac-btns">
              <button type="button" className="ac-btn ac-btn--sm" disabled={!!busy} onClick={() => run({ op: "preview", lessonId: l.id }, "preview")}>
                Preview
              </button>
              <button type="button" className="ac-btn ac-btn--sm" disabled={!!busy} onClick={() => run({ op: "hold", lessonId: l.id, held: !l.held })}>
                {l.held ? "Release" : "Hold back"}
              </button>
              {l.status === "needs_review" ? (
                <button type="button" className="ac-btn ac-btn--sm is-solid" disabled={!!busy} onClick={() => run({ op: "publish", lessonId: l.id })}>
                  Publish anyway
                </button>
              ) : null}
              {["needs_review", "failed"].includes(l.status) || l.error ? (
                <button type="button" className="ac-btn ac-btn--sm" disabled={!!busy} onClick={() => run({ op: "retry", lessonId: l.id })}>
                  Retry
                </button>
              ) : null}
              <Confirm className="ac-btn ac-btn--sm" disabled={!!busy} onConfirm={() => run({ op: "regenerate", lessonId: l.id })}>
                Start over
              </Confirm>
            </div>
            {l.issues && l.issues.length ? (
              <ul className="ac-issues">
                {l.issues.map((i, k) => (
                  <li key={k} className={`is-${i.severity}`}>
                    <span className="ac-mono">
                      {i.severity === "error" ? "✕" : "!"} {i.card ? `card ${i.card}` : "lesson"}
                    </span>{" "}
                    {i.claim ? <q>{i.claim}</q> : null} {i.problem}
                    {i.fix ? <span className="ac-sub">Fix: {i.fix}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ac-note">No issues recorded.</p>
            )}
            {l.status !== "queued" ? (
              <div className="ac-notes">
                <label className="ac-field">
                  <span>Send it back to Claude with notes (one per line, “12: the date is wrong”)</span>
                  <textarea id={`ac-notes-${l.id}`} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <button
                  type="button"
                  className="ac-btn ac-btn--sm"
                  disabled={!!busy || !notes.trim()}
                  onClick={async () => {
                    const r = await run({ op: "revise", lessonId: l.id, notes: parseNotes() });
                    if (r.ok) setNotes("");
                  }}
                >
                  Send back
                </button>
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function TopicRow({ t, editable, run, busy }) {
  const [mode, setMode] = useState(null); // null | "edit" | "swap"
  const [form, setForm] = useState({ title: t.title, yearLabel: t.yearLabel, wiki: t.wiki.join(", "), focus: t.focus });
  const [note, setNote] = useState("");
  const slot = t.position % 6;
  const save = async () => {
    const r = await run({ op: "edit-topic", topicId: t.id, fields: { ...form, wiki: form.wiki.split(",").map((s) => s.trim()).filter(Boolean) } }, `edit-${t.id}`);
    if (r.ok) setMode(null);
  };
  const swap = async () => {
    const r = await run({ op: "swap-topic", topicId: t.id, note }, `swap-${t.id}`);
    if (r.ok) {
      setMode(null);
      setNote("");
    }
  };
  return (
    <li className={`ac-topic${t.warning ? " has-warning" : ""}`}>
      <div className="ac-topic-head">
        <span className="ac-label">
          {DAYS[slot]} · {KIND_LABEL[t.kind]}
        </span>
        <b>{t.title}</b>
        <span className="ac-sub">
          {t.yearLabel} · {t.era} ·{" "}
          {t.wiki.map((w, i) => (
            <span key={w}>
              {i ? ", " : ""}
              <a href={`https://en.wikipedia.org/wiki/${encodeURIComponent(w.replace(/ /g, "_"))}`} target="_blank" rel="noreferrer">
                {w}
              </a>
            </span>
          ))}
        </span>
        <p className="ac-topic-focus">{t.focus}</p>
        {t.warning ? <p className="ac-error">{t.warning}</p> : null}
      </div>
      {editable ? (
        <div className="ac-btns">
          <button type="button" className="ac-btn ac-btn--sm" onClick={() => setMode(mode === "edit" ? null : "edit")}>
            Edit
          </button>
          <button type="button" className="ac-btn ac-btn--sm" onClick={() => setMode(mode === "swap" ? null : "swap")}>
            Swap
          </button>
          <button type="button" className="ac-btn ac-btn--sm" aria-label="Move a week earlier" disabled={!!busy || t.position < 6} onClick={() => run({ op: "move-topic", topicId: t.id, dir: -1 })}>
            ↑
          </button>
          <button type="button" className="ac-btn ac-btn--sm" aria-label="Move a week later" disabled={!!busy || t.position >= 24} onClick={() => run({ op: "move-topic", topicId: t.id, dir: 1 })}>
            ↓
          </button>
        </div>
      ) : null}
      {mode === "edit" ? (
        <div className="ac-form">
          <label className="ac-field">
            <span>Title</span>
            <input id={`ac-t-title-${t.id}`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="ac-field">
            <span>Year label</span>
            <input id={`ac-t-year-${t.id}`} value={form.yearLabel} onChange={(e) => setForm({ ...form, yearLabel: e.target.value })} />
          </label>
          <label className="ac-field">
            <span>Wikipedia articles (comma-separated, exact titles)</span>
            <input id={`ac-t-wiki-${t.id}`} value={form.wiki} onChange={(e) => setForm({ ...form, wiki: e.target.value })} />
          </label>
          <label className="ac-field">
            <span>Angle</span>
            <textarea id={`ac-t-focus-${t.id}`} rows={3} value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })} />
          </label>
          <button type="button" className="ac-btn ac-btn--sm is-solid" disabled={!!busy} onClick={save}>
            {busy === `edit-${t.id}` ? "Checking articles…" : "Save"}
          </button>
        </div>
      ) : null}
      {mode === "swap" ? (
        <div className="ac-form">
          <label className="ac-field">
            <span>Ask Claude for a different {t.kind} (optional note)</span>
            <input id={`ac-t-note-${t.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. someone less famous, or a woman of the period" />
          </label>
          <button type="button" className="ac-btn ac-btn--sm is-solid" disabled={!!busy} onClick={swap}>
            {busy === `swap-${t.id}` ? "Claude is thinking…" : "Swap it"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function Seasons({ seasons, run, busy }) {
  const [hint, setHint] = useState("");
  const [showApproved, setShowApproved] = useState(false);
  const proposed = seasons.filter((s) => s.status === "proposed");
  const approved = seasons.filter((s) => s.status === "approved");
  return (
    <section>
      <div className="ac-form ac-propose">
        <label className="ac-field">
          <span>Ask Claude to plan the next season (optional steer)</span>
          <input id="ac-propose-hint" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. Rome: the Republic" />
        </label>
        <button type="button" className="ac-btn" disabled={!!busy} onClick={() => run({ op: "propose", hint })}>
          {busy === "propose" ? "Claude is planning (a minute or two)…" : "Propose a season"}
        </button>
      </div>
      {proposed.map((s) => {
        const blocked = s.topics.filter((t) => !t.wiki.length).length;
        return (
          <article key={s.id} className="ac-season">
            <header>
              <p className="ac-label">
                Season {s.number} · proposed · {s.span}
              </p>
              <h2>{s.title}</h2>
              {s.intro ? <p className="ac-note">{s.intro}</p> : null}
              <div className="ac-btns">
                <button type="button" className="ac-btn is-solid" disabled={!!busy || blocked > 0} onClick={() => run({ op: "approve", seasonId: s.id })}>
                  {busy === "approve" ? "Scheduling…" : "Approve and schedule"}
                </button>
                <Confirm disabled={!!busy} onConfirm={() => run({ op: "discard", seasonId: s.id })}>
                  Discard
                </Confirm>
              </div>
              {blocked ? <p className="ac-error">{blocked} topics have no Wikipedia article. Edit or swap them first.</p> : null}
            </header>
            {[0, 1, 2, 3, 4].map((w) => (
              <section key={w} className="ac-season-week">
                <h3 className="ac-label">
                  Week {w + 1}
                  {s.themes[w] ? ` · ${s.themes[w]}` : ""}
                </h3>
                <ol>
                  {s.topics
                    .filter((t) => Math.floor(t.position / 6) === w)
                    .map((t) => (
                      <TopicRow key={t.id} t={t} editable run={run} busy={busy} />
                    ))}
                </ol>
              </section>
            ))}
          </article>
        );
      })}
      {!proposed.length ? <p className="ac-note">No season waiting for approval. The cron proposes one when fewer than two weeks of lessons are left.</p> : null}
      {approved.length ? (
        <div className="ac-approved">
          <button type="button" className="ac-btn ac-btn--quiet" aria-expanded={showApproved} onClick={() => setShowApproved(!showApproved)}>
            {showApproved ? "Hide" : "Show"} approved seasons ({approved.length})
          </button>
          {showApproved
            ? approved.map((s) => (
                <article key={s.id} className="ac-season is-approved">
                  <p className="ac-label">
                    Season {s.number} · {s.span}
                  </p>
                  <h2>{s.title}</h2>
                  <ol className="ac-compact">
                    {s.topics.map((t) => (
                      <li key={t.id}>
                        <span className="ac-mono">{DAYS[t.position % 6]}</span> {t.title}
                      </li>
                    ))}
                  </ol>
                </article>
              ))
            : null}
        </div>
      ) : null}
    </section>
  );
}

const REASON = { fact: "Fact", quote: "Quote", image: "Image", typo: "Typo", other: "Other" };

function Flags({ flags, lessons, run, busy }) {
  const open = flags.filter((f) => f.status === "open");
  const closed = flags.filter((f) => f.status !== "open");
  const lessonId = (slug) => (lessons.find((l) => l.slug === slug) || {}).id;
  if (!flags.length) return <p className="ac-note">No flags yet.</p>;
  return (
    <section>
      <ul className="ac-flags">
        {open.map((f) => (
          <li key={f.id}>
            <p>
              <span className="ac-pill is-warn">{REASON[f.reason] || f.reason}</span>{" "}
              <Link to={`/acta/${f.slug}${f.card != null ? `?card=${f.card}` : ""}`} target="_blank">
                {f.slug}
                {f.card != null ? `, card ${f.card + 1}` : ""}
              </Link>{" "}
              <span className="ac-sub">{new Date(f.created_at).toLocaleString("en-CA")}</span>
            </p>
            {f.note ? <p className="ac-flag-note">{f.note}</p> : null}
            <div className="ac-btns">
              <button type="button" className="ac-btn ac-btn--sm" disabled={!!busy} onClick={() => run({ op: "flag", flagId: f.id, status: "resolved" })}>
                Fixed it
              </button>
              <button type="button" className="ac-btn ac-btn--sm" disabled={!!busy} onClick={() => run({ op: "flag", flagId: f.id, status: "dismissed" })}>
                Dismiss
              </button>
              {lessonId(f.slug) ? (
                <button
                  type="button"
                  className="ac-btn ac-btn--sm"
                  disabled={!!busy}
                  onClick={async () => {
                    const r = await run({
                      op: "revise",
                      lessonId: lessonId(f.slug),
                      notes: [{ card: f.card != null ? f.card + 1 : null, problem: `A reader flagged this (${REASON[f.reason] || f.reason})${f.note ? `: ${f.note}` : "."} Check it against the sources and fix it if they agree.` }],
                    });
                    if (r.ok) run({ op: "flag", flagId: f.id, status: "resolved" });
                  }}
                >
                  Send back to Claude
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {!open.length ? <p className="ac-note">No open flags.</p> : null}
      {closed.length ? <p className="ac-note">{closed.length} closed.</p> : null}
    </section>
  );
}

function Preview({ preview, onClose }) {
  const errors = (preview.issues || []).filter((i) => i.severity === "error");
  return (
    <div className="ac-preview" role="dialog" aria-modal="true" aria-label="Lesson preview">
      {preview.lesson ? (
        <Feed
          lesson={preview.lesson}
          mode="preview"
          onExit={onClose}
          banner={
            <p className="ac-banner">
              Preview · <Pill status={preview.status} />
              {errors.length ? ` · ${errors.length} to fix` : ""}
            </p>
          }
        />
      ) : (
        <div className="ac-solo">
          <div className="ac-solo-inner">
            <p className="ac-body">Nothing written yet. Status: {preview.status}.</p>
            <button type="button" className="ac-btn is-solid" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
