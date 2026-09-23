import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, UserButton } from "@clerk/clerk-react";
import { loadSeries } from "./api";
import { BOWLERS } from "./bowlers";
import { badges, bowlerStats, headToHead, nights, trendPoints } from "./stats";
import { celebrationFor, milestones, tonightsLine, totals } from "./insights";
import { ALL_TIME, inSeason, seasonList, seasonSummary } from "./seasons";
import {
  DUDE,
  KONAMI,
  SECRETS,
  playSound,
  useKeySequence,
  useSecrets,
  useSoundSetting,
} from "./eggs";
import RecapScreen from "./parts/RecapScreen";
import EntryPanel from "./parts/EntryPanel";
import BowlerCards from "./parts/BowlerCards";
import HeadToHead from "./parts/HeadToHead";
import TrendChart from "./parts/TrendChart";
import TrophyShelf from "./parts/TrophyShelf";
import History from "./parts/History";
import StrikeBurst from "./parts/StrikeBurst";
import Milestones from "./parts/Milestones";
import TonightsLine from "./parts/TonightsLine";
import HandicapSim from "./parts/HandicapSim";
import Heatmap from "./parts/Heatmap";
import WrapCard from "./parts/WrapCard";
import NeonSign from "./parts/NeonSign";
import { SeasonBar, SeasonCompare } from "./parts/Seasons";
import "./Bowler.css";
import "./parts/stats.css";
import "./parts/insights.css";

/*
 * /bowler: a retro bowling-alley tracker for two league bowlers.
 *
 * Owns the one piece of server state (every saved series) and derives all
 * stats from it with pure functions (stats.js, insights.js, seasons.js).
 * The season picker scopes the "how am I doing" panels; forward-looking
 * ones (targets, the line, the simulator) always use all-time numbers,
 * because that's what the league's handicap uses.
 */
const TOAST_MS = 3200;

const Bowler = () => {
  const { getToken } = useAuth();
  const [series, setSeries] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [season, setSeason] = useState(ALL_TIME);
  const [celebration, setCelebration] = useState({ id: 0, variant: "strike" });
  const [wrapDate, setWrapDate] = useState(null);
  const [toast, setToast] = useState(null);
  const [dude, setDude] = useState(false);
  const [cosmic, setCosmic] = useState(false);
  const [soundOn, toggleSound] = useSoundSetting();
  const { found, discover } = useSecrets();
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

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const unlock = useCallback(
    (id) => {
      const secret = SECRETS.find((s) => s.id === id);
      if (!found.includes(id)) setToast(`Secret trophy: ${secret.label}`);
      discover(id);
    },
    [found, discover]
  );

  useKeySequence(DUDE, () => {
    setDude((on) => !on);
    unlock("dude");
  });
  useKeySequence(KONAMI, () => {
    setCosmic((on) => !on);
    unlock("konami");
  });

  const all = useMemo(() => series || [], [series]);
  const seasons = useMemo(() => seasonList(all), [all]);
  // A deleted season's key falls back to all time instead of an empty page.
  const activeSeason = seasons.some((s) => s.key === season) ? season : ALL_TIME;
  const scoped = useMemo(() => inSeason(all, activeSeason), [all, activeSeason]);

  const derived = useMemo(
    () => ({
      stats: Object.fromEntries(BOWLERS.map((b) => [b.key, bowlerStats(scoped, b.key)])),
      trophies: Object.fromEntries(BOWLERS.map((b) => [b.key, badges(all, b.key)])),
      h2h: headToHead(scoped),
      trend: trendPoints(scoped),
      nights: nights(all),
      goals: Object.fromEntries(BOWLERS.map((b) => [b.key, milestones(all, b.key)])),
      allStats: Object.fromEntries(BOWLERS.map((b) => [b.key, bowlerStats(all, b.key)])),
      totals: Object.fromEntries(BOWLERS.map((b) => [b.key, totals(all, b.key)])),
      line: tonightsLine(all),
      summary: seasonSummary(all),
    }),
    [all, scoped]
  );

  const goToEntry = useCallback(() => {
    entryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const onSaved = useCallback(
    async ({ bowledOn, entries }) => {
      const variant = celebrationFor(entries);
      setEditing(null);
      setCelebration((c) => ({ id: c.id + 1, variant }));
      if (soundOn) playSound(variant);
      await refresh();
      setWrapDate(bowledOn);
    },
    [refresh, soundOn]
  );

  const onEdit = useCallback(
    (night) => {
      setEditing(night);
      goToEntry();
    },
    [goToEntry]
  );

  const loading = series === null;
  const empty = !loading && all.length === 0;

  return (
    <div className={`bw ${cosmic ? "bw--cosmic" : ""} ${dude ? "bw--dude" : ""}`}>
      <div className="bw-lane" aria-hidden="true" />

      <header className="bw-top">
        <Link to="/" className="bw-home">
          <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Site
        </Link>
        <div className="bw-top-actions">
          <button
            type="button"
            className="bw-icon-btn"
            aria-pressed={soundOn}
            onClick={toggleSound}
            title={soundOn ? "Sound on" : "Sound off"}
          >
            <i className={`fa-solid ${soundOn ? "fa-volume-high" : "fa-volume-xmark"}`} aria-hidden="true" />
            <span className="sr-only">Sound effects</span>
          </button>
          <UserButton />
        </div>
      </header>

      <section className="bw-hero">
        <div className="bw-hero-copy">
          <NeonSign onBreak={() => unlock("sign")} />
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
          series={all}
          dude={dude}
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
          {!loading && (
            <SeasonBar seasons={seasons} value={activeSeason} onChange={setSeason} />
          )}
          <BowlerCards loading={loading} stats={derived.stats} />
          {!loading && (
            <div className="bw-duo">
              <TonightsLine line={derived.line} />
              <Milestones goals={derived.goals} />
            </div>
          )}
          <HeadToHead loading={loading} h2h={derived.h2h} stats={derived.stats} />
          <TrendChart loading={loading} points={derived.trend} />
          {!loading && <Heatmap series={scoped} />}
          {!loading && (
            <HandicapSim
              key={all.length}
              totals={derived.totals}
              stats={derived.allStats}
            />
          )}
          {!loading && <SeasonCompare summary={derived.summary} />}
          {!loading && <TrophyShelf trophies={derived.trophies} secrets={found} />}
          <History
            nights={derived.nights}
            getToken={getToken}
            onEdit={onEdit}
            onWrap={setWrapDate}
            onDeleted={refresh}
          />
        </>
      )}

      <StrikeBurst trigger={celebration.id} variant={celebration.variant} />
      <WrapCard date={wrapDate} series={all} onClose={() => setWrapDate(null)} />
      {toast && (
        <p className="bw-toast" role="status">
          <i className="fa-solid fa-trophy" aria-hidden="true" /> {toast}
        </p>
      )}
    </div>
  );
};

export default Bowler;
