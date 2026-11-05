import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import { loadKitchen } from "./api";
import "./Kitchen.css";

/*
 * /pantry/kitchen?k=<token>: the kitchen display. Read-only, no sign-in,
 * sized to be read from across the room on a Nest Hub (cast it from Home
 * Assistant) or a tablet on the fridge. Dark by default because it's on all
 * evening; ?theme=light overrides. Refreshes every five minutes and keeps a
 * tablet's screen awake where the browser allows it.
 *
 * The same feed (GET /api/pantry?kitchen=<token>) is what Home Assistant
 * reads to speak `say` on the kitchen speaker. See PANTRY.md.
 */
const REFRESH_MS = 5 * 60 * 1000;

const TIME = new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat("en-CA", { weekday: "long", day: "numeric", month: "long" });

const Kitchen = () => {
  const [params] = useSearchParams();
  const token = params.get("k") || "";
  const light = params.get("theme") === "light";
  const [feed, setFeed] = useState(null);
  const [state, setState] = useState(token ? "loading" : "denied");
  const [now, setNow] = useState(() => new Date());
  const [updated, setUpdated] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    let live = true;
    const load = async () => {
      const result = await loadKitchen(token);
      if (!live) return;
      if (result.ok) {
        setFeed(result.data);
        setState("ok");
        setUpdated(new Date());
      } else {
        setState(result.status === 404 ? "denied" : "offline");
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20 * 1000);
    return () => clearInterval(t);
  }, []);

  // A tablet on the fridge shouldn't fall asleep on the list.
  useEffect(() => {
    let lock = null;
    const grab = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") {
          lock = await navigator.wakeLock.request("screen");
        }
      } catch {
        /* not allowed here: the screen just sleeps as usual */
      }
    };
    grab();
    document.addEventListener("visibilitychange", grab);
    return () => {
      document.removeEventListener("visibilitychange", grab);
      if (lock) lock.release().catch(() => {});
    };
  }, []);

  const columns = feed
    ? [
        { key: "out", title: "Out", items: feed.out.map((i) => i.name) },
        { key: "low", title: "Running low", items: feed.low.map((i) => i.name) },
        { key: "soon", title: "Use soon", items: feed.useSoon.map((i) => i.name) },
        { key: "extra", title: "Also get", items: feed.extras },
      ].filter((c) => c.items.length)
    : [];

  return (
    <div className={`kt${light ? " is-light" : ""}`}>
      <Helmet>
        <title>Kitchen | Pantry</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <header className="kt-head">
        <div>
          <p className="kt-time">{TIME.format(now)}</p>
          <p className="kt-date">{DATE.format(now)}</p>
        </div>
        <p className="kt-label">
          <span>Pantry</span>
        </p>
      </header>

      {state === "denied" && <p className="kt-say">This kitchen link isn't right. Copy it again from Pantry → More.</p>}
      {state === "offline" && !feed && <p className="kt-say">Can't reach the pantry right now. Trying again shortly.</p>}
      {state === "loading" && <p className="kt-say is-quiet">Checking the shelves…</p>}

      {feed && (
        <>
          <p className="kt-say" key={feed.say}>
            {feed.say}
          </p>
          {columns.length > 0 && (
            <div className="kt-cols">
              {columns.map((c) => (
                <section key={c.key} className={`kt-col is-${c.key}`}>
                  <h2>
                    {c.title} <span>{c.items.length}</span>
                  </h2>
                  <ul>
                    {c.items.slice(0, 8).map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                    {c.items.length > 8 && <li className="kt-more">and {c.items.length - 8} more</li>}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <p className="kt-foot">
            {state === "offline" ? "Offline · showing " : "Updated "}
            {updated ? TIME.format(updated) : ""}
          </p>
        </>
      )}
    </div>
  );
};

export default Kitchen;
