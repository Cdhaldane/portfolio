import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, motionValue } from "framer-motion";
import CardHand from "./CardHand";
import RipPack from "./RipPack";
import Burst from "./Burst";
import { BottomBar, TopBar } from "./TableBars";
import { FanGrip, LegendGrip, RipGrip, SpinGrip } from "./Grips";
import { Banner, Flare, Flash, Rays, Shockwave } from "./TableFx";
import { STRIP } from "./PackArt";
import { useHoloTilt } from "../useHoloTilt";
import { PHASE, isRitual } from "../deckReducer";
import { CARDS_PER_PACK, packById, rankAt, rarityOf } from "../top5.data";
import {
  DEAL_CADENCE,
  SPEED_CADENCE,
  cardWidthFor,
  fanBounds,
  fanPose,
  handLayout,
  ripLayout,
  stageBox,
} from "../poses";
import { playSfx } from "../sfx";
import { today } from "../hooks";
import "./RipTable.css";

const QUIPS = {
  slow: "Savour it, why don't you.",
  fail: "Commit to it!",
  skipLegend: "Skipped the best part. Bold.",
  hype: "Now THAT is a reveal.",
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const isButton = (el) => el && (el.tagName === "BUTTON" || el.tagName === "A");

const cardInfo = (pack, fanIdx) => {
  const rank = rankAt(fanIdx);
  const card = pack.cards[rank - 1];
  return { rank, label: rarityOf(rank).label, title: card.title, take: card.take, card };
};

const focusables = (root) =>
  root
    ? [...root.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      )
    : [];

/*
 * The table: a modal overlay with one static lens over a preserve-3d world
 * holding the pack and the cards, flat FX layers above and below it, flat
 * grips for pointer input, and real buttons for everything else. It turns
 * animation completions into reducer actions; it never decides the flow.
 */
export default function RipTable({
  state,
  dispatch,
  order,
  vw,
  vh,
  origin,
  sound,
  lite,
  fine,
  reduced,
  godMode,
  shiny,
  speedDeal,
  onToggleSound,
  onToast,
  announce,
  onShark,
}) {
  const { phase, packId, run, entry, switchDir, revealed, inspected } = state;
  const pack = packById(packId);
  const stage = stageBox(vw, vh);
  const L = useMemo(
    () => handLayout({ stageW: stage.w, stageH: stage.h, cw: cardWidthFor(vw) }),
    [stage.w, stage.h, vw]
  );
  const R = useMemo(() => ripLayout({ stageW: stage.w, stageH: stage.h }), [stage.w, stage.h]);

  const [lifted, setLifted] = useState(null);
  const [backShown, setBackShown] = useState(false);
  const [torn, setTorn] = useState(false);
  const [charging, setCharging] = useState(false);
  const [fx, setFx] = useState([]);
  const [banner, setBanner] = useState(null);
  const [sheen, setSheen] = useState([0, 0, 0, 0, 0]);
  const [wobble, setWobble] = useState(0);
  const [seenRun, setSeenRun] = useState(run);
  // Reset per-deal UI state the moment a new deal starts (not an effect later).
  if (seenRun !== run) {
    setSeenRun(run);
    setLifted(null);
    setBackShown(false);
    setTorn(false);
    setCharging(false);
    setBanner(null);
    setSheen([0, 0, 0, 0, 0]);
  }
  // Fresh tear values per deal (idempotent, so StrictMode's double render is safe).
  const perRun = useRef(null);
  if (!perRun.current || perRun.current.run !== run) {
    perRun.current = { run, tear: motionValue(0), dir: motionValue(1) };
  }
  const { tear, dir: tearDir } = perRun.current;

  const rootRef = useRef(null);
  const worldRef = useRef(null);
  const primaryRef = useRef(null);
  const flipRef = useRef(null);
  const cardRefs = useRef([]);
  const spinRef = useRef(null);
  const chargeAt = useRef(0);
  const chargeLevel = useRef(0);
  const fxId = useRef(0);

  const cadence = speedDeal ? SPEED_CADENCE : DEAL_CADENCE;
  const liveIndex =
    phase === PHASE.INSPECT ? inspected : phase === PHASE.HAND ? lifted : phase === PHASE.REVEAL ? 4 : null;
  const holo = useHoloTilt({
    enabled: !reduced && liveIndex !== null && (fine || phase === PHASE.INSPECT),
    shimmer: !fine && phase === PHASE.INSPECT,
  });
  const ripHolo = useHoloTilt({ enabled: fine && !reduced && phase === PHASE.SEALED, maxX: 8, maxY: 10 });

  const legendBox = { x: 0, y: -8, w: L.cw * 0.9 * L.inspectScale, h: L.ch * 0.9 * L.inspectScale };
  const inspectBox = { x: 0, y: -L.captionH / 2, w: L.cw * L.inspectScale, h: L.ch * L.inspectScale };
  const packBox = { x: 0, y: 0, w: R.w * R.scale, h: R.h * R.scale };
  const fb = fanBounds(L);
  const fanBox = { x: (fb.left + fb.right) / 2, y: (fb.top + fb.bottom) / 2, w: fb.right - fb.left, h: fb.bottom - fb.top };

  const sfx = useCallback((kind) => sound && playSfx(kind), [sound]);
  const addFx = useCallback((item) => {
    fxId.current += 1;
    const id = fxId.current;
    setFx((list) => [...list, { ...item, id }]);
  }, []);
  const removeFx = useCallback((id) => setFx((list) => list.filter((f) => f.id !== id)), []);

  // ---- the rip ----
  const commitRip = useCallback(
    ({ slow = false } = {}) => {
      if (phase !== PHASE.SEALED) return;
      if (reduced) {
        dispatch({ type: "finish", today: today() });
        announce(`${pack.name} pack opened. Number 1: ${pack.cards[0].title}.`);
        return;
      }
      dispatch({ type: "rip" });
      if (slow) onToast(QUIPS.slow);
    },
    [phase, reduced, dispatch, announce, pack, onToast]
  );
  const failRip = useCallback(() => {
    animate(tear, 0, reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 26 });
    setWobble((w) => w + 1);
    onToast(QUIPS.fail);
  }, [tear, reduced, onToast]);
  const onTorn = useCallback(() => {
    setTorn(true);
    addFx({ kind: "flecks", x: 0, y: -packBox.h * (0.5 - STRIP), count: lite ? 14 : 24 });
    sfx("rip");
  }, [addFx, packBox.h, lite, sfx]);
  const onOpened = useCallback(() => {
    dispatch({ type: "ripped" });
    announce(`${pack.name} pack ripped open. Dealing five cards.`);
    sfx("swish");
  }, [dispatch, announce, pack.name, sfx]);

  // ---- the deal ----
  const onLanded = useCallback(
    (i) => {
      dispatch({ type: "landed", index: i });
      const { rank, label, title } = cardInfo(pack, i);
      const tier = rarityOf(rank).tier;
      const p = fanPose(i, L);
      if (tier !== "common") setSheen((s) => s.map((v, k) => (k === i ? v + 1 : v)));
      if (tier === "rare" || tier === "ultra") addFx({ kind: "dots", x: p.x, y: p.y, count: 10 });
      if (tier === "ultra") {
        addFx({ kind: "flare", x: p.x, y: p.y, size: L.cw * L.handScale * 1.8 });
        if (worldRef.current && !reduced) {
          animate(worldRef.current, { scale: [1, 1.015, 1] }, { duration: 0.25 });
        }
      }
      sfx(tier === "common" ? "tick" : `chime:${tier}`);
      announce(`Number ${rank}, ${label}: ${title}.${i === 3 ? " One card left. Press Enter to reveal." : ""}`);
    },
    [dispatch, pack, L, addFx, reduced, sfx, announce]
  );

  // ---- the legendary ----
  const startCharge = useCallback(() => {
    if (phase !== PHASE.LEGEND || charging) return;
    chargeAt.current = now();
    setCharging(true);
  }, [phase, charging]);
  const releaseCharge = useCallback(() => {
    if (phase !== PHASE.LEGEND) return;
    chargeLevel.current = charging ? Math.min(1, (now() - chargeAt.current) / 1200) : 0;
    setCharging(false);
    dispatch({ type: "reveal", today: today() });
  }, [phase, charging, dispatch]);
  const onCrossing = useCallback(() => {
    const level = chargeLevel.current;
    const hype = level >= 0.95;
    const base = lite ? 22 : 36;
    addFx({ kind: "flash" });
    addFx({ kind: "shock", x: 0, y: legendBox.y, size: legendBox.w });
    addFx({ kind: "confetti", x: 0, y: legendBox.y, count: Math.round(base * (0.75 + 0.25 * level)) + (hype ? 10 : 0) });
    setBanner({ text: hype ? "MAX HYPE PULL" : "LEGENDARY PULL", key: fxId.current });
    sfx("legend");
    announce(`Legendary! Number 1: ${pack.cards[0].title}.`);
    if (hype) onToast(QUIPS.hype);
  }, [lite, addFx, legendBox.y, legendBox.w, sfx, announce, pack, onToast]);
  const onRevealDone = useCallback(() => {
    dispatch({ type: "revealed" });
    setBanner(null);
  }, [dispatch]);

  const skip = useCallback(() => {
    if (!isRitual(state)) return;
    if (phase === PHASE.LEGEND) onToast(QUIPS.skipLegend);
    dispatch({ type: "finish", today: today() });
    setCharging(false);
    setBanner(null);
    announce(`${pack.name}: all five cards dealt. Number 1: ${pack.cards[0].title}.`);
  }, [state, phase, onToast, dispatch, announce, pack]);

  // ---- hand and inspect ----
  const inspect = useCallback(
    (i) => {
      dispatch({ type: "inspect", index: i });
      setBackShown(false);
    },
    [dispatch]
  );
  const step = useCallback(
    (delta) => {
      dispatch({ type: "step", delta });
      setBackShown(false);
    },
    [dispatch]
  );
  const close = useCallback(() => {
    dispatch({ type: "close" });
    setBackShown(false);
  }, [dispatch]);
  const onFace = useCallback((i, face) => setBackShown(face === "back"), []);
  const leave = useCallback(() => dispatch({ type: "shelf", today: today() }), [dispatch]);
  const switchPack = useCallback((delta) => dispatch({ type: "switch", delta }), [dispatch]);

  const canSwitch = phase === PHASE.SEALED || phase === PHASE.HAND || phase === PHASE.INSPECT;
  const at = order.indexOf(packId);
  const prevName = packById(order[(at - 1 + order.length) % order.length]).name;
  const nextName = packById(order[(at + 1) % order.length]).name;

  const onKeyDown = (e) => {
    const { key } = e;
    if (key === "Tab") {
      const els = focusables(rootRef.current);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (key === "Escape") {
      e.preventDefault();
      if (isRitual(state)) skip();
      else {
        dispatch({ type: "escape", today: today() });
        setBackShown(false);
      }
      return;
    }
    if ((key === "[" || key === "]") && canSwitch) {
      e.preventDefault();
      switchPack(key === "]" ? 1 : -1);
      return;
    }
    if (/^[1-5]$/.test(key) && (phase === PHASE.HAND || phase === PHASE.INSPECT)) {
      e.preventDefault();
      inspect(CARDS_PER_PACK - Number(key));
      return;
    }
    if (phase === PHASE.INSPECT && (key === "ArrowLeft" || key === "ArrowRight")) {
      e.preventDefault();
      step(key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (phase === PHASE.INSPECT && (key === "f" || key === "F")) {
      e.preventDefault();
      setBackShown((b) => !b);
      return;
    }
    if (phase === PHASE.HAND && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) {
      e.preventDefault();
      const cur = lifted ?? 4;
      const next =
        key === "Home" ? 0 : key === "End" ? 4 : Math.min(4, Math.max(0, cur + (key === "ArrowRight" ? 1 : -1)));
      setLifted(next);
      cardRefs.current[next]?.focus({ preventScroll: true });
      return;
    }
    if (phase === PHASE.SEALED && (key === "Enter" || key === " ") && !isButton(e.target)) {
      e.preventDefault();
      commitRip();
    }
  };

  // Focus follows the beat: the primary action, the card, or the toolbar.
  useEffect(() => {
    const focus = (el) => el?.focus({ preventScroll: true });
    if (phase === PHASE.SEALED || phase === PHASE.LEGEND) focus(primaryRef.current);
    else if (phase === PHASE.INSPECT) focus(flipRef.current);
    else if (phase === PHASE.HAND) focus(cardRefs.current[state.lastInspected ?? 4]);
    else focus(rootRef.current);
  }, [phase, run, state.lastInspected]);

  const onBackdrop = (e) => {
    if (e.target === e.currentTarget && phase === PHASE.INSPECT) close();
  };

  const showPack = phase === PHASE.SEALED || phase === PHASE.RIPPING;
  const showCards = phase !== PHASE.SEALED && (phase !== PHASE.RIPPING || torn);
  const packInitial = reduced
    ? false
    : entry === "switch"
      ? { x: (switchDir || 1) * stage.w * 0.62, y: 0, z: 0, rotate: (switchDir || 1) * 12, scale: R.scale }
      : origin
        ? { x: origin.x, y: origin.y, z: 0, rotate: origin.rotate, scale: origin.scale }
        : { x: 0, y: stage.h * 0.7, z: 0, rotate: -6, scale: R.scale };

  let info = null;
  if (phase === PHASE.HAND && lifted !== null) info = cardInfo(pack, lifted);
  if ((phase === PHASE.DEALING || phase === PHASE.LEGEND) && state.dealt > 0) info = cardInfo(pack, state.dealt - 1);
  if (phase === PHASE.REVEAL) info = cardInfo(pack, 4);
  const inspectInfo = phase === PHASE.INSPECT ? cardInfo(pack, inspected) : null;

  return (
    <motion.div
      ref={rootRef}
      className={`td-table ${godMode ? "td-god" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${pack.name} pack`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      transition={{ duration: 0.3 }}
    >
      <div className="td-table-backdrop" aria-hidden="true" />
      <TopBar
        pack={pack}
        collected={revealed ? CARDS_PER_PACK : state.dealt}
        prevName={prevName}
        nextName={nextName}
        canSwitch={canSwitch}
        canReseal={phase === PHASE.HAND || phase === PHASE.INSPECT}
        sound={sound}
        onLeave={leave}
        onSwitch={switchPack}
        onReseal={() => dispatch({ type: "reseal" })}
        onToggleSound={onToggleSound}
      />

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="td-stage"
        style={{ top: stage.top, height: stage.h, "--cw": `${L.cw}px`, "--ch": `${L.ch}px` }}
        onClick={onBackdrop}
      >
        <div className="td-fx td-fx--under">
          {phase === PHASE.LEGEND || phase === PHASE.REVEAL ? (
            <Rays x={0} y={legendBox.y} size={legendBox.w * 2} charging={charging} />
          ) : null}
          {fx.map((f) =>
            f.kind === "shock" ? (
              <Shockwave key={f.id} x={f.x} y={f.y} size={f.size} />
            ) : f.kind === "flare" ? (
              <Flare key={f.id} x={f.x} y={f.y} size={f.size} />
            ) : f.kind === "confetti" && !reduced ? (
              <Burst key={f.id} kind="confetti" count={f.count} seed={f.id} x={`calc(50% + ${f.x}px)`} y={`calc(50% + ${f.y}px)`} onDone={() => removeFx(f.id)} />
            ) : null
          )}
        </div>

        <div className="td-lens" style={{ perspectiveOrigin: `50% calc(50% + ${inspectBox.y}px)` }}>
          <div className="td-world td-3d" ref={worldRef}>
            <AnimatePresence custom={switchDir}>
              {showPack ? (
                <RipPack
                  key={`pack-${run}`}
                  pack={pack}
                  R={R}
                  stageW={stage.w}
                  initial={packInitial}
                  tear={tear}
                  dir={tearDir}
                  phase={phase}
                  reduced={reduced}
                  holoStyle={ripHolo.style}
                  wobble={wobble}
                  onTorn={onTorn}
                  onOpened={onOpened}
                />
              ) : null}
            </AnimatePresence>
            <AnimatePresence custom={switchDir}>
              {showCards ? (
                <CardHand
                  key={`hand-${run}`}
                  pack={pack}
                  phase={phase}
                  entry={entry}
                  switchDir={switchDir}
                  revealed={revealed}
                  inspected={inspected}
                  backShown={backShown}
                  torn={torn}
                  lifted={lifted}
                  focusIndex={lifted ?? state.lastInspected ?? 4}
                  L={L}
                  R={R}
                  stageW={stage.w}
                  origin={origin}
                  cadence={cadence}
                  reduced={reduced}
                  lite={lite}
                  liveIndex={liveIndex}
                  holoStyle={holo.style}
                  charging={charging}
                  godMode={godMode}
                  shiny={shiny}
                  pulledAt={state.opened[packId]?.pulledAt}
                  sheen={sheen}
                  cardRefs={cardRefs}
                  spinRef={spinRef}
                  onLanded={onLanded}
                  onCrossing={onCrossing}
                  onRevealDone={onRevealDone}
                  onFace={onFace}
                  onShark={onShark}
                  onCardClick={inspect}
                  onCardFocus={setLifted}
                />
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        <div className="td-fx td-fx--over">
          {fx.map((f) =>
            f.kind === "flash" ? (
              <Flash key={f.id} />
            ) : f.kind === "flecks" || f.kind === "dots" ? (
              <Burst key={f.id} kind={f.kind} count={f.count} seed={f.id} x={`calc(50% + ${f.x}px)`} y={`calc(50% + ${f.y}px)`} onDone={() => removeFx(f.id)} />
            ) : null
          )}
          <AnimatePresence>
            {banner ? <Banner key={banner.key} text={banner.text} y={legendBox.y - legendBox.h / 2 - 28} /> : null}
          </AnimatePresence>
        </div>

        {phase === PHASE.SEALED && !reduced ? (
          <RipGrip box={packBox} tear={tear} dir={tearDir} holo={ripHolo} onCommit={commitRip} onFail={failRip} />
        ) : null}
        {phase === PHASE.LEGEND ? <LegendGrip box={legendBox} onHold={startCharge} onRelease={releaseCharge} /> : null}
        {phase === PHASE.HAND ? (
          <FanGrip box={fanBox} L={L} lifted={lifted} holo={holo} onLift={setLifted} onPick={inspect} />
        ) : null}
        {phase === PHASE.INSPECT ? <SpinGrip box={inspectBox} index={inspected} spinRef={spinRef} holo={holo} /> : null}

        {inspectInfo && L.captionH ? (
          <div className="td-inspect-caption" aria-hidden="true">
            <b>{inspectInfo.title}</b>
            <span>{inspectInfo.take}</span>
          </div>
        ) : null}
      </div>

      <BottomBar
        phase={phase}
        reduced={reduced}
        fine={fine}
        info={info}
        backShown={backShown}
        primaryRef={primaryRef}
        flipRef={flipRef}
        onRip={() => commitRip()}
        onSkip={skip}
        onHold={startCharge}
        onRelease={releaseCharge}
        onRevealClick={() => {
          if (phase === PHASE.LEGEND && !charging) releaseCharge();
        }}
        onStep={step}
        onFlip={() => setBackShown((b) => !b)}
        onClose={close}
      />

      <div className="td-sr">
        {pack.cards.map((c, k) => (
          <p key={c.id} id={`td-desc-${pack.id}-${CARDS_PER_PACK - 1 - k}`}>
            {c.take} {c.meta}. {pack.statLabels.map((l, s) => `${l} ${c.stats[s]} of 10`).join(", ")}. {c.fun}.
          </p>
        ))}
      </div>
    </motion.div>
  );
}
