import { memo, useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import PackArt from "./PackArt";
import { useHoloTilt } from "../useHoloTilt";
import { SPRING, cloudPose, homePose } from "../poses";
import { CARDS_PER_PACK } from "../top5.data";
import "./PackShelf.css";

const Pips = ({ lit }) => (
  <span className={`td-pips ${lit ? "is-lit" : ""}`} aria-hidden="true">
    {Array.from({ length: CARDS_PER_PACK }, (_, k) => (
      <span key={k} className={`td-pip ${k === CARDS_PER_PACK - 1 ? "td-pip--crown" : ""}`} style={{ "--k": k }}>
        {k === CARDS_PER_PACK - 1 ? <i className="fa-solid fa-crown" /> : null}
      </span>
    ))}
  </span>
);

const DROP = { x: 0, y: -420, z: 0, rotateX: 0, rotateY: 0, rotate: -18 };

const ShelfPack = memo(function ShelfPack({
  pack,
  index,
  count,
  opened,
  picked,
  lit,
  reduced,
  narrow,
  fine,
  tidy,
  glint,
  dropIn,
  tabIndex,
  buttonRef,
  onPick,
  onFocusIndex,
}) {
  const cellRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [arrived, setArrived] = useState(reduced);
  const holo = useHoloTilt({ enabled: fine && !reduced && !picked && lit, maxX: 10, maxY: 12 });

  const home = useMemo(() => {
    const h = homePose(index);
    return tidy ? { ...h, y: 0, rotate: 0 } : h;
  }, [index, tidy]);
  const start = useMemo(
    () => (dropIn ? DROP : cloudPose(index, count, narrow)),
    [dropIn, index, count, narrow]
  );
  const lifted = hover && !picked;
  const target = !lit ? start : lifted ? { ...home, y: home.y - 6, z: 40, rotate: 0 } : home;
  const arrival = dropIn
    ? { type: "spring", stiffness: 140, damping: 14 }
    : { ...SPRING.assemble, delay: 0.35 + index * 0.05 };

  const onEnter = useCallback(
    (e) => {
      holo.handlers.onPointerEnter(e);
      if (e.pointerType !== "touch") {
        setArrived(true);
        setHover(true);
      }
    },
    [holo.handlers]
  );
  const onLeave = useCallback(
    (e) => {
      holo.handlers.onPointerLeave(e);
      setHover(false);
    },
    [holo.handlers]
  );

  const label = `${pack.name} pack, ${opened ? `opened, ${CARDS_PER_PACK} of ${CARDS_PER_PACK} collected` : `sealed, ${CARDS_PER_PACK} cards`}`;

  return (
    <li
      ref={cellRef}
      className={`td-cell ${picked ? "is-picked" : ""} ${pack.secret ? "is-secret" : ""}`}
      onPointerEnter={onEnter}
      onPointerMove={holo.handlers.onPointerMove}
      onPointerLeave={onLeave}
    >
      <motion.div
        className="td-pack-slot td-3d"
        initial={reduced ? false : start}
        animate={target}
        transition={arrived ? SPRING.hover : arrival}
        onAnimationComplete={arrived ? undefined : () => setArrived(true)}
      >
        <motion.div className="td-pack-tilt td-3d" style={holo.style}>
          <motion.button
            ref={buttonRef}
            type="button"
            className={`td-pack ${opened ? "is-torn" : ""} ${glint ? "is-glint" : ""}`}
            style={{ "--h": pack.hue }}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: lit ? 1 : 0 }}
            transition={{ duration: 0.01, delay: dropIn || reduced ? 0 : 0.35 + index * 0.05 }}
            tabIndex={tabIndex}
            aria-label={label}
            onClick={() => onPick(pack.id, cellRef.current)}
            onFocus={() => {
              setHover(true);
              onFocusIndex(index);
            }}
            onBlur={() => setHover(false)}
          >
            {/* One clipped body for art + glare, so a torn pack clips both
                along the same edge (and the button keeps its focus ring). */}
            <span className="td-pack-body">
              <PackArt pack={pack} secret={pack.secret} />
              <span className="td-glare" aria-hidden="true" />
            </span>
          </motion.button>
        </motion.div>
      </motion.div>
      <Pips lit={opened} />
    </li>
  );
});

const columnsOf = (list) => {
  if (!list || typeof getComputedStyle !== "function") return 1;
  const cols = getComputedStyle(list).gridTemplateColumns;
  return cols && cols !== "none" ? cols.trim().split(/\s+/).length : 1;
};

/*
 * The playmat: one perspective lens PER cell (so every pack is viewed head-on
 * however far the shelf scrolls), arrival from an index-seeded depth cloud,
 * pointer tilt with glare, and a roving-focus grid for keyboards.
 */
export default function PackShelf({
  packs,
  opened,
  pickedId,
  lit,
  reduced,
  narrow,
  fine,
  tidy,
  freshId,
  buttonRefs,
  onPick,
}) {
  const listRef = useRef(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const firstSealed = packs.findIndex((p) => !opened[p.id]);
  // Stable per-pack ref callbacks, so the memoised packs don't re-render
  // every time the deck state changes behind the table.
  const refFns = useMemo(
    () =>
      Object.fromEntries(
        packs.map((p) => [
          p.id,
          (el) => {
            buttonRefs.current[p.id] = el;
          },
        ])
      ),
    [packs, buttonRefs]
  );

  const onKeyDown = (e) => {
    const cols = columnsOf(listRef.current);
    const moves = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols };
    let next = null;
    if (e.key in moves) next = focusIndex + moves[e.key];
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = packs.length - 1;
    if (next === null) return;
    e.preventDefault();
    const clamped = Math.min(packs.length - 1, Math.max(0, next));
    setFocusIndex(clamped);
    buttonRefs.current[packs[clamped].id]?.focus();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <ul className="td-shelf" ref={listRef} onKeyDown={onKeyDown} aria-label="Booster packs">
      {packs.map((pack, i) => (
        <ShelfPack
          key={pack.id}
          pack={pack}
          index={i}
          count={packs.length}
          opened={Boolean(opened[pack.id])}
          picked={pickedId === pack.id}
          lit={lit}
          reduced={reduced}
          narrow={narrow}
          fine={fine}
          tidy={tidy}
          glint={i === firstSealed && !reduced}
          dropIn={freshId === pack.id}
          tabIndex={i === focusIndex ? 0 : -1}
          buttonRef={refFns[pack.id]}
          onPick={onPick}
          onFocusIndex={setFocusIndex}
        />
      ))}
    </ul>
  );
}
