import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { LOCATIONS, agoText, badgeFor, qtyText } from "../format";

/*
 * Everything on hand, shelf by shelf (numbered like the rest of the site's
 * sections). A row's "−" is the everyday tap: whole packs above one,
 * quarters below, so a bag of milk goes 1 → ¾ → ½ → a little → out.
 */
const StockView = ({ items, today, pending, onOpen, onUsedSome, onAdd, onScan }) => {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [where, setWhere] = useState("all");

  const counts = useMemo(() => {
    const c = {};
    for (const i of items) c[i.location] = (c[i.location] || 0) + 1;
    return c;
  }, [items]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = items.filter(
      (i) => (where === "all" || i.location === where) && (!q || i.name.toLowerCase().includes(q))
    );
    return LOCATIONS.map((l) => ({ ...l, items: shown.filter((i) => i.location === l.key) })).filter(
      (g) => g.items.length
    );
  }, [items, query, where]);

  if (!items.length) {
    return (
      <section className="pt-empty">
        <p className="pt-eyebrow">An empty shelf</p>
        <h2>Scan your next grocery receipt and the pantry fills itself in.</h2>
        <p>
          Claude reads the receipt, works out what each line is, and you check it before anything is
          saved. After a couple of shops it starts to notice what you buy every week.
        </p>
        <div className="pt-empty-actions">
          <button type="button" className="pt-btn is-primary" onClick={onScan}>
            <i className="fa-solid fa-receipt" aria-hidden="true" /> Scan a receipt
          </button>
          <button type="button" className="pt-btn" onClick={() => onAdd()}>
            Add something by hand
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="pt-stock">
      <div className="pt-tools">
        <label className="pt-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find something"
            aria-label="Find something in the pantry"
          />
        </label>
        <div className="pt-chips" role="group" aria-label="Where">
          <Chip active={where === "all"} onClick={() => setWhere("all")} label="All" count={items.length} />
          {LOCATIONS.filter((l) => counts[l.key]).map((l) => (
            <Chip
              key={l.key}
              active={where === l.key}
              onClick={() => setWhere(l.key)}
              label={l.key === "home" ? "House" : l.label}
              count={counts[l.key]}
            />
          ))}
        </div>
      </div>

      {!groups.length && <p className="pt-none">Nothing matches “{query}”.</p>}

      {groups.map((g, gi) => (
        <section key={g.key} className="pt-group" aria-labelledby={`pt-g-${g.key}`}>
          <h2 className="pt-group-head" id={`pt-g-${g.key}`}>
            <span className="pt-num">{String(gi + 1).padStart(2, "0")}</span>
            {g.label}
            <span className="pt-group-count">{g.items.length}</span>
          </h2>
          <ul className="pt-rows">
            {g.items.map((item, i) => (
              <motion.li
                key={item.id}
                className={`pt-row is-${item.status.state}`}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : Math.min(i, 12) * 0.025, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <StockRow
                  item={item}
                  today={today}
                  busy={pending.has(item.id)}
                  onOpen={() => onOpen(item.id)}
                  onUsedSome={() => onUsedSome(item)}
                />
              </motion.li>
            ))}
          </ul>
        </section>
      ))}

      <button type="button" className="pt-add" onClick={() => onAdd()}>
        <i className="fa-solid fa-plus" aria-hidden="true" /> Add something by hand
      </button>
    </div>
  );
};

const Chip = ({ active, onClick, label, count }) => (
  <button type="button" className={`pt-chip${active ? " is-active" : ""}`} aria-pressed={active} onClick={onClick}>
    {label} <span>{count}</span>
  </button>
);

const StockRow = ({ item, today, busy, onOpen, onUsedSome }) => {
  const badge = badgeFor(item.status);
  const meta = [qtyText(item.qty) === "none" ? "none left" : qtyText(item.qty)];
  if (item.lastBoughtOn) meta.push(`bought ${agoText(item.lastBoughtOn, today)}`);
  return (
    <>
      <button type="button" className="pt-row-main" onClick={onOpen}>
        <span className="pt-row-name">{item.name}</span>
        <span className="pt-row-meta">{meta.join(" · ")}</span>
      </button>
      {badge && <span className={`pt-badge is-${badge.tone}`}>{badge.label}</span>}
      <button
        type="button"
        className="pt-row-use"
        onClick={onUsedSome}
        disabled={busy || item.qty <= 0}
        aria-label={`Used some ${item.name}`}
      >
        {busy ? <span className="pt-spin" aria-hidden="true" /> : <i className="fa-solid fa-minus" aria-hidden="true" />}
      </button>
    </>
  );
};

export default StockView;
