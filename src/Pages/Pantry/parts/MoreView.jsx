import { useEffect, useState } from "react";
import InstallButton from "../../../Components/AppIdentity/InstallButton";
import * as api from "../api";
import { currentSubscription, disableReminders, enableReminders, pushSupported } from "../push";
import { dayText, money } from "../format";

/*
 * The settings-ish tab: reminders on this phone, the kitchen display link
 * (for a Nest Hub or a tablet on the fridge), and recent receipts with undo.
 */
const MoreView = ({ data, getToken, onSnapshot, say }) => {
  return (
    <div className="pt-more-view">
      <Reminders push={data.push} getToken={getToken} />
      <Kitchen kitchen={data.kitchen} say={say} />
      <Receipts receipts={data.receipts} getToken={getToken} onSnapshot={onSnapshot} say={say} />
      <section className="pt-card">
        <h2 className="pt-card-title">On your phone</h2>
        <p>Pantry works best installed: it opens straight to the shelf, and reminders need it on iPhone.</p>
        <InstallButton name="Pantry" className="pt-btn is-primary" tipClassName="pt-hint">
          <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" /> Add to home screen
        </InstallButton>
      </section>
    </div>
  );
};

const Reminders = ({ push, getToken }) => {
  const [on, setOn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    currentSubscription()
      .then((sub) => live && setOn(Boolean(sub)))
      .catch(() => live && setOn(false));
    return () => {
      live = false;
    };
  }, []);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const result = on ? await disableReminders(getToken) : await enableReminders(getToken, push && push.publicKey);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setOn(!on);
  };

  const available = pushSupported() && push && push.enabled;
  return (
    <section className="pt-card">
      <h2 className="pt-card-title">Reminders</h2>
      <p>
        A note in the late afternoon when something new is out, low or due, or needs using up. And a
        heads-up the moment someone else marks a thing out, in case you're passing a store.
      </p>
      {available ? (
        <button type="button" className={`pt-btn${on ? "" : " is-primary"}`} onClick={toggle} disabled={busy || on === null}>
          {busy ? "One moment…" : on ? "Turn off on this phone" : "Turn on for this phone"}
        </button>
      ) : (
        <p className="pt-hint">
          {pushSupported()
            ? "Reminders aren't switched on for the site yet (VAPID keys)."
            : "This browser can't show reminders."}
        </p>
      )}
      {error && (
        <p className="pt-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
};

const Kitchen = ({ kitchen, say }) => {
  const url = kitchen ? `${window.location.origin}${kitchen.path}` : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      say("Copied the kitchen link.");
    } catch {
      say("Couldn't copy. Long-press the link instead.");
    }
  };
  return (
    <section className="pt-card">
      <h2 className="pt-card-title">Kitchen display</h2>
      <p>
        A big, glanceable page for the Nest Hub or a tablet on the fridge, plus a feed Home Assistant
        can read aloud on the kitchen speaker. It's read-only and needs no sign-in, so keep the link in
        the house.
      </p>
      {url ? (
        <div className="pt-row-actions">
          <a className="pt-btn is-primary" href={kitchen.path} target="_blank" rel="noreferrer">
            Open it
          </a>
          <button type="button" className="pt-btn" onClick={copy}>
            Copy link
          </button>
        </div>
      ) : (
        <p className="pt-hint">Not set up yet: it needs PANTRY_KITCHEN_TOKEN in Vercel.</p>
      )}
    </section>
  );
};

const Receipts = ({ receipts, getToken, onSnapshot, say }) => {
  const [armed, setArmed] = useState(null);
  const [busy, setBusy] = useState(null);

  const undo = async (r) => {
    if (armed !== r.id) return setArmed(r.id);
    setBusy(r.id);
    const result = await api.undoReceipt(getToken, r.id);
    setBusy(null);
    setArmed(null);
    if (!result.ok) return say(result.error);
    onSnapshot(result.data);
    say("Receipt undone. Its items came back off the shelf.");
  };

  return (
    <section className="pt-card">
      <h2 className="pt-card-title">Recent receipts</h2>
      {!receipts.length ? (
        <p className="pt-hint">None yet.</p>
      ) : (
        <ul className="pt-receipts">
          {receipts.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.store || "Receipt"}</strong>
                <span>
                  {dayText(r.purchasedOn)} · {r.lineCount} line{r.lineCount === 1 ? "" : "s"}
                  {r.totalCents != null ? ` · ${money(r.totalCents)}` : ""}
                </span>
              </div>
              <button
                type="button"
                className={`pt-btn is-small${armed === r.id ? " is-danger is-armed" : ""}`}
                onClick={() => undo(r)}
                disabled={busy === r.id}
              >
                {busy === r.id ? "Undoing…" : armed === r.id ? "Tap to undo" : "Undo"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default MoreView;
