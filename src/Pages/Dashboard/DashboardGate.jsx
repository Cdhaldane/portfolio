import React, { useEffect, useRef, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import "./DashboardGate.css";

/*
 * Access gate for the hidden /dashboard tree.
 *
 *  - On mount it asks /api/dashboard-access whether this visitor's IP is on the
 *    allowlist. If so, access is granted with no password (the "we're at my IP"
 *    case) and remembered for the tab via sessionStorage.
 *  - Otherwise it shows a cyberpunk lock screen; the typed password is POSTed to
 *    the same endpoint and checked server-side (default "cat"), so the secret
 *    never ships in the client bundle.
 */
const STORAGE_KEY = "dash-access-granted";

const DashboardGate = () => {
  const [status, setStatus] = useState(() =>
    sessionStorage.getItem(STORAGE_KEY) === "1" ? "granted" : "checking"
  );
  const [password, setPassword] = useState("");
  const [detectedIp, setDetectedIp] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  // Probe IP-based access once on mount (skip if already unlocked this tab).
  useEffect(() => {
    if (status === "granted") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/dashboard-access");
        const data = await res.json();
        if (cancelled) return;
        if (data.ip) setDetectedIp(data.ip);
        if (data.granted) {
          sessionStorage.setItem(STORAGE_KEY, "1");
          setStatus("granted");
        } else {
          setStatus("locked");
        }
      } catch {
        // Endpoint unreachable (e.g. local `npm start` with no API) → fall back
        // to the password prompt rather than locking everyone out.
        if (!cancelled) setStatus("locked");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (status === "locked") inputRef.current?.focus();
  }, [status]);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting || !password) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        // Non-JSON response (e.g. the CRA dev server returned index.html
        // because the API isn't running) — not a wrong-password case.
      }
      if (res.ok && data && data.granted) {
        sessionStorage.setItem(STORAGE_KEY, "1");
        setStatus("granted");
      } else if (res.status === 401) {
        setError("ACCESS DENIED — incorrect passcode.");
        setPassword("");
        inputRef.current?.focus();
      } else {
        setError("GATE OFFLINE — API not reachable. Run `npm run dev`.");
      }
    } catch {
      setError("LINK FAILURE — could not reach the gate.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "granted") return <Outlet />;

  return (
    <div className="gate">
      <div className="gate-scan" aria-hidden="true" />
      <div className="gate-grid-bg" aria-hidden="true" />

      <div className="gate-box">
        <span className="gate-corner gate-corner--tl" aria-hidden="true" />
        <span className="gate-corner gate-corner--tr" aria-hidden="true" />
        <span className="gate-corner gate-corner--bl" aria-hidden="true" />
        <span className="gate-corner gate-corner--br" aria-hidden="true" />

        <div className="gate-lockicon">
          <i className="fa-solid fa-lock" />
        </div>

        <span className="gate-kicker">
          <span className="gate-led" /> RESTRICTED NODE
        </span>
        <h1 className="gate-title">OPS//CONSOLE</h1>

        {status === "checking" ? (
          <p className="gate-checking">
            <i className="fa-solid fa-circle-notch fa-spin" /> VERIFYING CLEARANCE…
          </p>
        ) : (
          <form className="gate-form" onSubmit={submit}>
            <label className="gate-label" htmlFor="gate-pass">
              ENTER PASSCODE
            </label>
            <input
              id="gate-pass"
              ref={inputRef}
              type="password"
              className="gate-input"
              value={password}
              autoComplete="off"
              placeholder="••••••"
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
            />
            <button className="gate-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <i className="fa-solid fa-circle-notch fa-spin" />
              ) : (
                <>
                  <span>AUTHENTICATE</span>
                  <i className="fa-solid fa-angles-right" />
                </>
              )}
            </button>

            {error && <p className="gate-error">{error}</p>}

            {detectedIp && (
              <p className="gate-ip">
                YOUR IP&nbsp;·&nbsp;<strong>{detectedIp}</strong>
                <span>add it to DASHBOARD_ALLOWED_IPS to skip this</span>
              </p>
            )}
          </form>
        )}

        <Link to="/" className="gate-back">
          <i className="fa-solid fa-chevron-left" /> RETURN TO SITE
        </Link>
      </div>
    </div>
  );
};

export default DashboardGate;
