import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, UserButton } from "@clerk/clerk-react";
import { loadSeries } from "./api";
import { BOWLERS } from "./bowlers";
import { badges, bowlerStats, headToHead, nights, trendPoints } from "./stats";
import RecapScreen from "./parts/RecapScreen";
import EntryPanel from "./parts/EntryPanel";
import BowlerCards from "./parts/BowlerCards";
import HeadToHead from "./parts/HeadToHead";
import TrendChart from "./parts/TrendChart";
import TrophyShelf from "./parts/TrophyShelf";
import History from "./parts/History";
import StrikeBurst from "./parts/StrikeBurst";
import "./Bowler.css";
import "./parts/stats.css";

/*
 * /bowler: a retro bowling-alley tracker for two league bowlers.
 *
 * Owns the one piece of server state (every saved series) and derives all
 * stats from it with pure functions in stats.js, so a save or delete just
 * re-fetches and every panel re-renders from the same source of truth.
 */
const Bowler = () => {
  const { getToken } = useAuth();
  const [series, setSeries] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [strikeKey, setStrikeKey] = useState(0);
  const entryRef = useRef(null);

  const refresh = useCallback(async () => {
    const result = await loadSeries(getToken);
    if (result.ok) {
      setSeries(result.series);
      setLoadError(null);
    } else {
      setLoadError(result.error);
      setSeries((prev) => prev || []);
    }
  }, [getToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const derived = useMemo(() => {
    const list = series || [];
    return {
      stats: Object.fromEntries(BOWLERS.map((b) => [b.key, bowlerStats(list, b.key)])),
      trophies: Object.fromEntries(BOWLERS.map((b) => [b.key, badges(list, b.key)])),
      h2h: headToHead(list),
      trend: trendPoints(list),
      nights: nights(list),
    };
  }, [series]);

  const goToEntry = useCallback(() => {
    entryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const onSaved = useCallback(async () => {
    setEditing(null);
    setStrikeKey((k) => k + 1);
    await refresh();
  }, [refresh]);

  const onEdit = useCallback(
    (night) => {
      setEditing(night);
      goToEntry();
    },
    [goToEntry]
  );

  const loading = series === null;
  const empty = !loading && series.length === 0;

  return (
    <div className="bw">
      <div className="bw-lane" aria-hidden="true" />

      <header className="bw-top">
        <Link to="/" className="bw-home">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Site
        </Link>
        <UserButton />
      </header>

      <section className="bw-hero">
        <div className="bw-hero-copy">
          <h1 className="bw-sign">
            <span className="bw-sign-word">Bowler</span>
          </h1>
          <p className="bw-hero-sub">
            Every league night, on the record. Snap the recap screen or type in
            three games.
          </p>
          <button type="button" className="bw-btn bw-btn--primary" onClick={goToEntry}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add a night
          </button>
        </div>
        <RecapScreen
          loading={loading}
          night={derived.nights[0] || null}
          series={series || []}
        />
      </section>

      {loadError && (
        <p className="bw-banner" role="alert">
          <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {loadError}
          <button type="button" className="bw-link" onClick={refresh}>
            Retry
          </button>
        </p>
      )}

      <div ref={entryRef} className="bw-anchor">
        <EntryPanel
          getToken={getToken}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
          onSaved={onSaved}
        />
      </div>

      {empty ? (
        <section className="bw-empty">
          <div className="bw-empty-pins" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className="bw-pin" style={{ "--i": i }} />
            ))}
          </div>
          <h2>The lanes are open.</h2>
          <p>Add your first league night and the stats, rivalry and trophies fill in here.</p>
        </section>
      ) : (
        <>
          <BowlerCards loading={loading} stats={derived.stats} />
          <HeadToHead loading={loading} h2h={derived.h2h} stats={derived.stats} />
          <TrendChart loading={loading} points={derived.trend} />
          {!loading && <TrophyShelf trophies={derived.trophies} />}
          <History
            nights={derived.nights}
            getToken={getToken}
            onEdit={onEdit}
            onDeleted={refresh}
          />
        </>
      )}

      <StrikeBurst trigger={strikeKey} />
    </div>
  );
};

export default Bowler;
