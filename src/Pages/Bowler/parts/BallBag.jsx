import { forwardRef, useEffect, useRef, useState } from "react";
import { animate, createScope, createTimeline, onScroll, spring, stagger, utils } from "animejs";
import { BOWLERS, BOWLER_BY_KEY } from "../bowlers";
import { HOUSE_BALL, ballSeed, bestBall, featuredBall } from "../balls";
import BallArt from "./BallArt";
import BallForm from "./BallForm";
import LaneShot from "./LaneShot";

/*
 * "In the bag": both bowlers' balls, how each one actually scores, and the
 * lane up top to roll any of them down. `report` comes from ballReport()
 * over the selected season, so the numbers follow the season picker like
 * every other "how am I doing" panel.
 */
const CARD_BALL = 64;
const ROLL_IN_PX = 150;
const DEG = 180 / Math.PI;
const REDUCE = "(prefers-reduced-motion: reduce)";

const otherOf = (key) => BOWLERS.find((b) => b.key !== key).key;

const Delta = ({ value }) => {
  if (value === null) return null;
  const up = value > 0;
  const flat = value === 0;
  return (
    <p className={`bw-ballcard-delta ${flat ? "" : up ? "is-up" : "is-down"}`}>
      {!flat && (
        <i className={`fa-solid ${up ? "fa-arrow-trend-up" : "fa-arrow-trend-down"}`} aria-hidden="true" />
      )}{" "}
      {flat ? "Level with" : `${up ? "+" : ""}${value} pins/game vs`} your other games
    </p>
  );
};

const BallCard = ({ ball, owner, best, fresh, onEdit, onRoll }) => {
  const cardRef = useRef(null);
  const liftRef = useRef(null);
  const spinRef = useRef(null);
  const shadowRef = useRef(null);
  const mine = ball.by[owner];
  const other = otherOf(owner);
  const theirs = ball.by[other];

  useEffect(() => {
    const scope = createScope({ root: cardRef, mediaQueries: { reduce: REDUCE } }).add((self) => {
      if (self.matches.reduce) return undefined;
      if (fresh) {
        // Just added: it drops into the bag, bounces, and settles.
        animate(liftRef.current, { y: [-120, 0], duration: 1000, ease: "outBounce" });
        animate(shadowRef.current, { scale: [0.25, 1], opacity: [0.15, 1], duration: 1000, ease: "outBounce" });
        animate(spinRef.current, { rotate: [-260, 0], duration: 1100, ease: "outCubic" });
      }
      const card = cardRef.current;
      const spinUp = () =>
        animate(spinRef.current, { rotate: "+=360", ease: spring({ bounce: 0.3, duration: 1100 }) });
      card.addEventListener("pointerenter", spinUp);
      return () => card.removeEventListener("pointerenter", spinUp);
    });
    return () => scope.revert();
    // `fresh` only matters on the first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <li ref={cardRef} className={`bw-ballcard ${ball.retired ? "is-retired" : ""}`}>
      <div className="bw-ballcard-orb">
        <span ref={shadowRef} className="bw-ballcard-shadow" aria-hidden="true" />
        <span ref={liftRef} className="bw-ballcard-lift">
          <BallArt ref={spinRef} color={ball.color} seed={ballSeed(ball)} size={CARD_BALL} />
        </span>
      </div>
      <div className="bw-ballcard-body">
        <p className="bw-ballcard-name">
          {ball.name}
          {best && (
            <span className="bw-ballcard-best">
              <i className="fa-solid fa-crown" aria-hidden="true" /> Best average
            </span>
          )}
        </p>
        <p className="bw-ballcard-meta">
          {ball.weight ? `${ball.weight} lb` : "Weight not set"}
          {ball.retired ? " · retired" : ""}
        </p>
        {mine.games ? (
          <dl className="bw-ballcard-stats">
            <div>
              <dt>Avg</dt>
              <dd>{mine.average}</dd>
            </div>
            <div>
              <dt>Games</dt>
              <dd>{mine.games}</dd>
            </div>
            <div>
              <dt>High</dt>
              <dd>{mine.high}</dd>
            </div>
          </dl>
        ) : (
          <p className="bw-ballcard-none">Not thrown yet</p>
        )}
        <Delta value={mine.vsRest} />
        {theirs.games > 0 && (
          <p className="bw-ballcard-borrow">
            {BOWLER_BY_KEY[other].name} borrowed it: {theirs.games} {theirs.games === 1 ? "game" : "games"},{" "}
            {theirs.average} avg
          </p>
        )}
        <div className="bw-ballcard-actions">
          <button type="button" className="bw-link" onClick={onRoll}>
            <i className="fa-solid fa-bowling-ball" aria-hidden="true" /> Roll it
          </button>
          <button type="button" className="bw-link" onClick={onEdit}>
            <i className="fa-solid fa-pen" aria-hidden="true" /> Edit
          </button>
        </div>
      </div>
    </li>
  );
};

const BallBag = forwardRef(function BallBag(
  { report, untagged, getToken, onChanged, request, soundOn },
  ref
) {
  const gridRef = useRef(null);
  const laneRef = useRef(null);
  const [form, setForm] = useState(null); // { owner, id } — id null = adding
  const [laneId, setLaneId] = useState(null);

  // Balls added after the first render get the drop-in; the rest roll in.
  const seen = useRef(null);
  if (seen.current === null) seen.current = new Set(report.map((b) => b.id));
  const fresh = new Set(report.filter((b) => !seen.current.has(b.id)).map((b) => b.id));
  useEffect(() => {
    report.forEach((b) => seen.current.add(b.id));
  });

  // "Put a ball in the bag" from the entry form opens the add form here.
  // Remember which request was handled, so a remount (empty page → first
  // night saved) doesn't replay an old one.
  const handled = useRef(request ? request.n : 0);
  useEffect(() => {
    if (!request || request.n === handled.current) return;
    handled.current = request.n;
    setForm({ owner: request.owner, id: null });
  }, [request]);

  // The bag's balls roll in from the left when it scrolls into view, each
  // turning exactly as far as it travels.
  useEffect(() => {
    const scope = createScope({ root: gridRef, mediaQueries: { reduce: REDUCE } }).add((self) => {
      const lifts = [...gridRef.current.querySelectorAll(".bw-ballcard-lift")];
      const spins = lifts.map((l) => l.querySelector(".bw-orb-spin")).filter(Boolean);
      if (self.matches.reduce || !lifts.length) return;
      const tilt = -(ROLL_IN_PX / (CARD_BALL / 2)) * DEG;
      utils.set(lifts, { x: -ROLL_IN_PX, opacity: 0 });
      utils.set(spins, { rotate: tilt });
      createTimeline({
        autoplay: onScroll({ target: gridRef.current, enter: "88% top", repeat: false }),
      })
        .add(
          lifts,
          {
            x: [-ROLL_IN_PX, 0],
            opacity: [{ from: 0, to: 1, duration: 240 }],
            duration: 1150,
            ease: "outCubic",
            delay: stagger(110),
          },
          0
        )
        .add(
          spins,
          {
            rotate: [tilt, 0],
            duration: 1150,
            ease: "outCubic",
            delay: stagger(110),
          },
          0
        );
    });
    return () => scope.revert();
  }, []);

  const featured = featuredBall(report);
  const laneBall = report.find((b) => b.id === laneId) || featured;
  const shown = laneBall || HOUSE_BALL;
  const laneStats = laneBall && laneBall.by[laneBall.owner];
  const laneTitle = laneBall
    ? `${BOWLER_BY_KEY[laneBall.owner].name}'s ${laneBall.name}`
    : "A house ball";
  const laneDetail = !laneBall
    ? "Put your own balls in the bag to roll them here."
    : laneStats.games
    ? `${laneStats.average} avg over ${laneStats.games} ${laneStats.games === 1 ? "game" : "games"}${
        featured && laneBall.id === featured.id && laneStats.games >= 3 ? ", the hottest ball in the bag" : ""
      }`
    : "Hasn't been thrown yet";

  const roll = (ball) => {
    setLaneId(ball.id);
    laneRef.current?.throwBall();
  };

  const done = async () => {
    await onChanged();
    setForm(null);
  };

  const total = report.length;

  return (
    <section ref={ref} className="bw-bag bw-anchor" aria-labelledby="bw-bag-title">
      <h2 id="bw-bag-title" className="bw-h2">
        In the bag
        <small>
          {total} {total === 1 ? "ball" : "balls"}
        </small>
      </h2>

      <LaneShot
        ref={laneRef}
        ball={shown}
        seed={ballSeed(shown)}
        title={laneTitle}
        detail={laneDetail}
        soundOn={soundOn}
      />

      <div ref={gridRef} className="bw-bag-grid">
        {BOWLERS.map(({ key, name }) => {
          const mine = report.filter((b) => b.owner === key);
          const active = mine
            .filter((b) => !b.retired)
            .sort((a, b) => b.by[key].games - a.by[key].games || a.id - b.id);
          const retired = mine.filter((b) => b.retired);
          const best = bestBall(report, key);
          const adding = form && form.id === null && form.owner === key;

          const card = (b) =>
            form && form.id === b.id ? (
              <li key={b.id} className="bw-ballcard bw-ballcard--editing">
                <BallForm
                  ball={b}
                  owner={key}
                  getToken={getToken}
                  thrown={b.by.cha.games + b.by.van.games}
                  onDone={done}
                  onCancel={() => setForm(null)}
                />
              </li>
            ) : (
              <BallCard
                key={b.id}
                ball={b}
                owner={key}
                best={best === b.id}
                fresh={fresh.has(b.id)}
                onEdit={() => setForm({ owner: key, id: b.id })}
                onRoll={() => roll(b)}
              />
            );

          return (
            <div key={key} className={`bw-bag-col bw-bag-col--${key}`}>
              <header className="bw-bag-colhead">
                <h3>
                  <span className={`bw-chip bw-chip--${key}`} aria-hidden="true" /> {name}'s bag
                </h3>
                {!adding && (
                  <button type="button" className="bw-link" onClick={() => setForm({ owner: key, id: null })}>
                    <i className="fa-solid fa-plus" aria-hidden="true" /> Add a ball
                  </button>
                )}
              </header>

              {adding && (
                <div className="bw-ballcard bw-ballcard--editing">
                  <BallForm owner={key} getToken={getToken} onDone={done} onCancel={() => setForm(null)} />
                </div>
              )}

              {active.length > 0 ? (
                <ul className="bw-bag-list">{active.map(card)}</ul>
              ) : (
                !adding && (
                  <p className="bw-bag-empty">
                    Nothing in here yet. Add the ball {name} throws and every game gets tagged with it.
                  </p>
                )
              )}

              {retired.length > 0 && (
                <details className="bw-bag-retired">
                  <summary>
                    Retired <span>{retired.length}</span>
                  </summary>
                  <ul className="bw-bag-list">{retired.map(card)}</ul>
                </details>
              )}

              {untagged[key] > 0 && active.length > 0 && (
                <p className="bw-bag-hint">
                  <i className="fa-solid fa-tag" aria-hidden="true" /> {untagged[key]} of {name}'s games
                  have no ball yet. Edit a score sheet to tag them.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
});

export default BallBag;
