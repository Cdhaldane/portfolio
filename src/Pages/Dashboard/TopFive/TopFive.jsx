import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { AnimatePresence, MotionConfig, useReducedMotion } from "framer-motion";
import { KONAMI, useKeySequence } from "../../Bowler/eggs";
import Header from "./parts/Header";
import PackShelf from "./parts/PackShelf";
import RipTable from "./parts/RipTable";
import SecretsRow from "./parts/SecretsRow";
import Checklist from "./parts/Checklist";
import Burst from "./parts/Burst";
import { PageBanner, Toast, YardTruck } from "./parts/Overlays";
import { TORN_CLIP } from "./parts/PackArt";
import {
  SECRETS,
  SECRET_PACK,
  collectedCount,
  sanitizeOpened,
  sanitizeSecrets,
  visiblePacks,
} from "./top5.data";
import { PHASE, deckReducer, initDeck, isTableOpen, visibleOrder } from "./deckReducer";
import {
  hasFinePointer,
  readJSON,
  useFontsReady,
  useLiteTier,
  useToast,
  useViewport,
  writeJSON,
} from "./hooks";
import { PACK_RATIO, cardWidthFor, homePose, ripLayout, stageBox } from "./poses";
import { playSfx } from "./sfx";
import { assertPreserve3d } from "./dev3d";
import "./TopFive.css";

// Load the display faces before the wordmark extrudes (they're display=swap).
const FACES = ['1em "Bungee"', '1em "Monoton"', '1em "Kalam"', '1em "Caveat Brush"'];
// Typed eggs contain none of the table's single-key shortcuts (F, [ ], 1-5).
const SHINY = ["s", "h", "i", "n", "y"];
const YARD = ["y", "a", "r", "d"];
const KEYS = { opened: "td1-opened", secrets: "td1-secrets", sound: "td1-sound" };
const SPEED_AFTER = 3; // packs opened before the deal speeds up

const loadDeck = () =>
  initDeck({
    opened: sanitizeOpened(readJSON(KEYS.opened, {})),
    bonus: sanitizeSecrets(readJSON(KEYS.secrets, [])).includes("bugs"),
  });

/*
 * TOP DECK: "My Top 5 Things" as a collectible card set, docked in the
 * OPS//CONSOLE. This component is the conductor: persistence, the deck
 * reducer, easter eggs and page chrome. The table (RipTable) runs the ritual.
 */
export default function TopFive() {
  const reduced = Boolean(useReducedMotion());
  const lite = useLiteTier();
  const [fine] = useState(hasFinePointer);
  const lit = useFontsReady(FACES);
  const { vw, vh } = useViewport();

  const [state, dispatch] = useReducer(deckReducer, undefined, loadDeck);
  const [secrets, setSecrets] = useState(() => sanitizeSecrets(readJSON(KEYS.secrets, [])));
  const [sound, setSound] = useState(() => readJSON(KEYS.sound, false) === true);
  const [origin, setOrigin] = useState(null);
  const [godMode, setGodMode] = useState(false);
  const [shiny, setShiny] = useState(false);
  const [tidy, setTidy] = useState(false);
  const [truck, setTruck] = useState(0);
  const [spoiled, setSpoiled] = useState(false);
  const [banner, setBanner] = useState(null);
  const [bursts, setBursts] = useState([]);
  const [dropPending, setDropPending] = useState(false);
  const [freshId, setFreshId] = useState(null);
  const [announcement, setAnnouncement] = useState("");
  const [toast, showToast] = useToast();

  const rootRef = useRef(null);
  const pageRef = useRef(null);
  const buttonRefs = useRef({});
  const secretsRef = useRef(secrets);
  secretsRef.current = secrets;

  const open = isTableOpen(state);

  useEffect(() => writeJSON(KEYS.opened, state.opened), [state.opened]);
  useEffect(() => writeJSON(KEYS.secrets, secrets), [secrets]);
  useEffect(() => writeJSON(KEYS.sound, sound), [sound]);

  const announce = useCallback(
    (msg) => setAnnouncement((prev) => (prev === msg ? `${msg} ` : msg)),
    []
  );
  const sfx = useCallback((kind) => sound && playSfx(kind), [sound]);

  const discover = useCallback(
    (id) => {
      if (secretsRef.current.includes(id)) return;
      const secret = SECRETS.find((s) => s.id === id);
      setSecrets((prev) => (prev.includes(id) ? prev : [...prev, id]));
      showToast(`Secret rare found: ${secret.label}!`);
      announce(`Secret rare found: ${secret.label}.`);
    },
    [showToast, announce]
  );

  // ---- easter eggs ----
  useKeySequence(KONAMI, () => {
    const next = !godMode;
    setGodMode(next);
    if (next) {
      discover("godpack");
      setBanner({ text: "GOD PACK", key: Date.now() });
      sfx("fanfare");
      announce("God pack! Every card is legendary now.");
    } else {
      showToast("God pack off. Back to reality.");
    }
  });
  useKeySequence(SHINY, () => {
    const next = !shiny;
    setShiny(next);
    if (next) discover("shiny");
    showToast(next ? "Shinies are real." : "Shinies off.");
  });
  useKeySequence(YARD, () => {
    setTruck((n) => n + 1);
    setTidy(true);
    discover("yard");
    showToast("Yard truck inbound. Shunting packs into a tidy row.");
    sfx("horn");
  });
  const onShark = useCallback(() => {
    discover("shark");
    showToast("Card shark!");
  }, [discover, showToast]);

  // ---- master set: the bonus pack drops once you're back at the shelf ----
  const bonusSeen = useRef(state.bonus);
  useEffect(() => {
    if (!state.bonus || bonusSeen.current) return;
    bonusSeen.current = true;
    discover("bugs");
    setDropPending(true);
    setBanner({ text: "MASTER SET", key: Date.now() });
    setBursts((b) => [...b, { id: Date.now(), count: lite ? 22 : 36 }]);
    sfx("fanfare");
    announce("Master set complete! A secret ninth pack is waiting on the shelf.");
  }, [state.bonus, discover, lite, sfx, announce]);
  useEffect(() => {
    if (!dropPending || open) return;
    setDropPending(false);
    setFreshId(SECRET_PACK.id);
    sfx("thud");
  }, [dropPending, open, sfx]);

  const packs = useMemo(() => {
    const all = visiblePacks(state.opened, state.bonus);
    return dropPending ? all.filter((p) => !p.secret) : all;
  }, [state.opened, state.bonus, dropPending]);

  // ---- picking a pack: measure its shelf slot for the FLIP onto the table ----
  const onPick = useCallback(
    (packId, cell) => {
      const { top, h } = stageBox(vw, vh);
      const R = ripLayout({ stageW: vw, stageH: h });
      const rect = cell?.getBoundingClientRect();
      const slot = cell?.querySelector(".td-pack-slot");
      let next = null;
      if (rect && rect.width && slot) {
        const pw = slot.offsetWidth;
        const index = packs.findIndex((p) => p.id === packId);
        next = {
          x: rect.left + slot.offsetLeft + pw / 2 - vw / 2,
          y: rect.top + slot.offsetTop + (pw * PACK_RATIO) / 2 - (top + h / 2),
          rotate: tidy ? 0 : homePose(index).rotate,
          scale: pw / R.w,
          cardScale: (pw * 0.84) / cardWidthFor(vw),
        };
      }
      setOrigin(next);
      dispatch({ type: "pick", packId });
      sfx("swish");
    },
    [vw, vh, packs, tidy, sfx]
  );
  const openFromChecklist = useCallback((packId) => {
    setOrigin(null);
    dispatch({ type: "pick", packId });
  }, []);

  // ---- the page behind the table: no scroll, no focus, no reading ----
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    if (open) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    } else {
      el.removeAttribute("inert");
      el.removeAttribute("aria-hidden");
    }
  }, [open]);

  // Focus returns to the pack you came from.
  const lastPhase = useRef(state.phase);
  useEffect(() => {
    const was = lastPhase.current;
    lastPhase.current = state.phase;
    if (was !== PHASE.SHELF && state.phase === PHASE.SHELF && state.lastPackId) {
      buttonRefs.current[state.lastPackId]?.focus({ preventScroll: true });
    }
  }, [state.phase, state.lastPackId]);

  useEffect(() => {
    assertPreserve3d(rootRef.current);
  }, [state.phase, lit]);

  const toggleSound = useCallback(() => {
    setSound((s) => {
      if (!s) playSfx("tick");
      return !s;
    });
  }, []);
  const spoil = useCallback(() => {
    setSpoiled(true);
    showToast("Fine. No confetti for you.");
    announce("Every pick is now revealed in the checklist.");
  }, [showToast, announce]);
  const toChecklist = useCallback(() => {
    document
      .getElementById("td-checklist")
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [reduced]);
  const clearBanner = useCallback(() => setBanner(null), []);
  const clearTruck = useCallback(() => setTruck(0), []);

  const openedCount = Object.keys(state.opened).length;

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={rootRef}
        className={`td ${lit ? "is-lit" : ""} ${open ? "is-locked" : ""}`}
        style={{ "--td-torn": TORN_CLIP }}
      >
        <Helmet>
          <title>Top Deck | Charlie Haldane</title>
          <meta name="robots" content="noindex, nofollow" />
        </Helmet>
        <div className="td-bg td-bg--felt" aria-hidden="true" />
        <div className="td-bg td-bg--grid" aria-hidden="true" />
        <div className="td-bg td-bg--lamp" aria-hidden="true" />

        <div className="td-page" ref={pageRef}>
          <Header
            collected={collectedCount(state.opened)}
            sound={sound}
            onToggleSound={toggleSound}
            onChecklist={toChecklist}
          />
          <main>
            <section className="td-section td-section--shelf" aria-labelledby="td-shelf-h">
              <h2 className="td-sec-h td-reveal" style={{ "--n": 4 }} id="td-shelf-h">
                <span className="td-sec-n" aria-hidden="true">01</span>
                Pick a pack
              </h2>
              <p className="td-sec-note td-reveal" style={{ "--n": 5 }}>
                pick a pack, any pack
                <svg className="td-arrow" viewBox="0 0 60 30" aria-hidden="true">
                  <path d="M3 6 C 20 2, 38 6, 50 22 M 50 22 L 41 20 M 50 22 L 51 13" />
                </svg>
              </p>
              <PackShelf
                packs={packs}
                opened={state.opened}
                pickedId={open ? state.packId : null}
                lit={lit}
                reduced={reduced}
                narrow={vw < 560}
                fine={fine}
                tidy={tidy}
                freshId={freshId}
                buttonRefs={buttonRefs}
                onPick={onPick}
              />
            </section>
            <SecretsRow found={secrets} />
            <Checklist
              packs={packs}
              opened={state.opened}
              spoiled={spoiled}
              onSpoil={spoil}
              onOpen={openFromChecklist}
            />
          </main>
          <footer className="td-foot">
            <span>Not for resale · Pull rates independently audited by Charlie (biased)</span>
            <span>Illus. C. Haldane · © MMXXVI</span>
          </footer>
        </div>

        <AnimatePresence>
          {open ? (
            <RipTable
              key="table"
              state={state}
              dispatch={dispatch}
              order={visibleOrder(state)}
              vw={vw}
              vh={vh}
              origin={origin}
              sound={sound}
              lite={lite}
              fine={fine}
              reduced={reduced}
              godMode={godMode}
              shiny={shiny}
              speedDeal={openedCount >= SPEED_AFTER}
              onToggleSound={toggleSound}
              onToast={showToast}
              announce={announce}
              onShark={onShark}
            />
          ) : null}
        </AnimatePresence>

        {truck && !reduced ? <YardTruck key={truck} onDone={clearTruck} /> : null}
        <div className="td-burst-layer" aria-hidden="true">
          {reduced
            ? null
            : bursts.map((b) => (
                <Burst
                  key={b.id}
                  kind="confetti"
                  count={b.count}
                  seed={b.id % 97}
                  x="50%"
                  y="38%"
                  onDone={() => setBursts((list) => list.filter((x) => x.id !== b.id))}
                />
              ))}
        </div>
        <AnimatePresence>
          {banner ? <PageBanner key={banner.key} text={banner.text} onDone={clearBanner} /> : null}
        </AnimatePresence>
        <AnimatePresence>{toast ? <Toast key={toast.id} text={toast.text} /> : null}</AnimatePresence>
        <p className="td-sr" aria-live="polite">
          {announcement}
        </p>
      </div>
    </MotionConfig>
  );
}
