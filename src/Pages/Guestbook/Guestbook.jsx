import { useCallback, useEffect, useState } from "react";
import Reveal from "../../Components/Reveal/Reveal";
import ScrollProgress from "../../Components/ScrollProgress/ScrollProgress";
import Seo from "../../Components/Seo/Seo";
import "./Guestbook.css";

const NAME_MAX = 40;
const MESSAGE_MAX = 280;

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch (_) {
    return "";
  }
};

const Guestbook = () => {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | warming | error
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [justSigned, setJustSigned] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/guestbook");
      const data = await res.json();
      if (data.configured === false) {
        setStatus("warming");
        return;
      }
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setStatus("ready");
    } catch (_) {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setFormError("");
    const n = name.trim();
    const m = message.trim();
    if (!n || !m) {
      setFormError("Add your name and a message.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/guestbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, message: m, website }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.entry) {
        setEntries((prev) => [data.entry, ...prev]);
        setName("");
        setMessage("");
        setStatus("ready");
        setJustSigned(true);
        setTimeout(() => setJustSigned(false), 2600);
      } else {
        setFormError(data.error || "Couldn't sign right now — please try again.");
      }
    } catch (_) {
      setFormError("Network hiccup — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="gb">
      <Seo
        title="Guestbook"
        path="/guestbook"
        description="Sign Charlie Haldane's guestbook — leave a note, a hello, or a hot take."
      />
      <ScrollProgress />

      <div className="gb-inner">
        <Reveal as="header" className="gb-head">
          <span className="gb-kicker">/ Guestbook</span>
          <h1 className="gb-title">Leave your mark.</h1>
          <p className="gb-sub">
            Passing through? Sign the wall — a hello, a hot take, a favourite
            album. It sticks around (until the spam bots find me).
          </p>
        </Reveal>

        <Reveal as="form" className="gb-form" delay={80} onSubmit={submit}>
          {/* Honeypot — hidden from humans, catnip for bots. */}
          <input
            className="gb-hp"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            aria-hidden="true"
          />

          <input
            className="gb-input gb-name-input"
            placeholder="Your name"
            maxLength={NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Your name"
          />

          <div className="gb-field">
            <textarea
              className="gb-input gb-textarea"
              placeholder="Say something…"
              maxLength={MESSAGE_MAX}
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-label="Your message"
            />
            <span className="gb-count">
              {message.length}/{MESSAGE_MAX}
            </span>
          </div>

          {formError && <p className="gb-error">{formError}</p>}

          <button className="gb-submit" type="submit" disabled={submitting}>
            {submitting ? "Signing…" : justSigned ? "Signed ✓" : "Sign the guestbook"}
          </button>
        </Reveal>

        <section className="gb-list" aria-label="Guestbook entries">
          {status === "loading" && <p className="gb-note">Loading the wall…</p>}
          {status === "warming" && (
            <p className="gb-note">The guestbook is warming up — check back soon.</p>
          )}
          {status === "error" && (
            <p className="gb-note">Couldn't reach the guestbook right now.</p>
          )}
          {status === "ready" && entries.length === 0 && (
            <p className="gb-note">No notes yet — be the first to sign. ✍️</p>
          )}

          {entries.map((en, i) => (
            <Reveal
              as="article"
              className="gb-entry"
              key={en.id ?? `${en.name}-${i}`}
              delay={Math.min(i * 40, 240)}
            >
              <p className="gb-msg">{en.message}</p>
              <div className="gb-entry-meta">
                <span className="gb-entry-name">{en.name}</span>
                <span className="gb-entry-date">{fmtDate(en.created_at)}</span>
              </div>
            </Reveal>
          ))}
        </section>
      </div>
    </main>
  );
};

export default Guestbook;
