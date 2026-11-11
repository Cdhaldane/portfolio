import { useEffect, useState } from "react";
import { currentSubscription, disableReminders, enableReminders, pushSupported } from "../push";

/*
 * The league-night reminder switch for this phone: a bell in the header.
 * The server works out league night from the saved nights and sends one
 * nudge that afternoon, with the series that lifts each average a pin. The
 * outcome (or why it can't switch on) comes back through `onMessage`, so it
 * shows in the page's toast.
 */
const LeagueBell = ({ getToken, push, league, onMessage }) => {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    currentSubscription()
      .then((sub) => live && setOn(Boolean(sub)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!pushSupported()) return null;

  const when = league ? `${league.label}s` : null;
  const title = on
    ? `League-night reminder is on${when ? ` (${when})` : ""}`
    : "Remind me on league night";

  async function toggle() {
    setBusy(true);
    const result = on
      ? await disableReminders(getToken)
      : await enableReminders(getToken, push && push.enabled ? push.publicKey : null);
    setBusy(false);
    if (!result.ok) {
      onMessage({ icon: "fa-bell-slash", text: result.error });
      return;
    }
    setOn(!on);
    onMessage(
      on
        ? { icon: "fa-bell-slash", text: "League-night reminder off." }
        : {
            icon: "fa-bell",
            text: when
              ? `Reminder on. It comes ${when} in the afternoon.`
              : "Reminder on. It starts once two nights land on the same weekday.",
          }
    );
  }

  return (
    <button
      type="button"
      className="bw-icon-btn"
      aria-pressed={on}
      disabled={busy}
      onClick={toggle}
      title={title}
    >
      <i className={`fa-solid ${on ? "fa-bell" : "fa-bell-slash"}`} aria-hidden="true" />
      <span className="sr-only">League-night reminder</span>
    </button>
  );
};

export default LeagueBell;
