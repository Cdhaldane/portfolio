import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import * as api from "../api";
import { agoText, money, qtyText } from "../format";

/*
 * The shopping list builds itself: anything out, low, or usually due again
 * by now, plus whatever someone typed in. "Got it" counts as buying one, so
 * ticking things off in the store keeps the pantry right without a receipt.
 */
const ListView = ({ items, extras, today, pending, onGot, onDismiss, onOpen, onExtrasChange, getToken, say }) => {
  const reduce = useReducedMotion();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState(null);

  const sections = useMemo(() => {
    const listed = items.filter((i) => i.status.onList);
    return [
      { key: "out", title: "Out", hint: "Nothing left", items: listed.filter((i) => i.status.state === "out") },
      { key: "low", title: "Running low", hint: "A little left", items: listed.filter((i) => i.status.state === "low") },
      {
        key: "due",
        title: "Probably due",
        hint: "Bought like clockwork, and it's about that time",
        items: listed.filter((i) => i.status.state === "due"),
      },
    ].filter((s) => s.items.length);
  }, [items]);

  const listed = sections.flatMap((s) => s.items);
  const priced = listed.filter((i) => i.unitCents != null);
  const estimate = priced.reduce((sum, i) => sum + i.unitCents, 0);
  const total = listed.length + extras.length;

  const add = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setAdding(true);
    const result = await api.addExtra(getToken, draft);
    setAdding(false);
    if (!result.ok) return say(result.error);
    setDraft("");
    onExtrasChange(result.extras);
  };

  const dismissFromMenu = (id, mode) => {
    setMenu(null);
    onDismiss(id, mode);
  };

  const doneExtra = async (extra) => {
    const result = await api.deleteExtra(getToken, extra.id);
    if (!result.ok) return say(result.error);
    onExtrasChange(result.extras);
  };

  const share = async () => {
    const lines = [...listed.map((i) => i.name), ...extras.map((e) => e.name)];
    const text = `Shopping list\n${lines.map((l) => `- ${l}`).join("\n")}`;
    try {
      if (navigator.share) await navigator.share({ title: "Shopping list", text });
      else {
        await navigator.clipboard.writeText(text);
        say("Copied the list.");
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  const rowMotion = reduce
    ? { initial: false, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, x: 48, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] } },
      };

  return (
    <div className="pt-list">
      <header className="pt-list-head">
        <div>
          <p className="pt-eyebrow">Shopping list</p>
          <h2 className="pt-list-title">
            {total ? `${total} thing${total === 1 ? "" : "s"} to get` : "Nothing to buy"}
          </h2>
          {priced.length > 0 && (
            <p className="pt-list-estimate">
              About {money(estimate)} for the {priced.length} with a price
            </p>
          )}
        </div>
        {total > 0 && (
          <button type="button" className="pt-icon-btn" onClick={share} aria-label="Share the list">
            <i className="fa-solid fa-arrow-up-from-bracket" aria-hidden="true" />
          </button>
        )}
      </header>

      <form className="pt-list-add" onSubmit={add}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add something else…"
          aria-label="Add to the shopping list"
          maxLength={60}
        />
        <button type="submit" className="pt-btn is-primary" disabled={adding || !draft.trim()}>
          Add
        </button>
      </form>

      {!total && (
        <p className="pt-none">
          Everything's stocked. Things land here when they run out, run low, or are usually due again.
        </p>
      )}

      {sections.map((s, si) => (
        <section key={s.key} className={`pt-group is-${s.key}`}>
          <h3 className="pt-group-head">
            <span className="pt-num">{String(si + 1).padStart(2, "0")}</span>
            {s.title}
            <span className="pt-group-count">{s.items.length}</span>
          </h3>
          <ul className="pt-rows">
            <AnimatePresence initial={false}>
              {s.items.map((item) => (
                <motion.li key={item.id} className={`pt-row pt-list-row is-${item.status.state}`} {...rowMotion}>
                  <button
                    type="button"
                    className="pt-check"
                    onClick={() => onGot(item)}
                    disabled={pending.has(item.id)}
                    aria-label={`Got ${item.name}`}
                  >
                    <i className="fa-solid fa-check" aria-hidden="true" />
                  </button>
                  <button type="button" className="pt-row-main" onClick={() => onOpen(item.id)}>
                    <span className="pt-row-name">{item.name}</span>
                    <span className="pt-row-meta">{listMeta(item, today)}</span>
                  </button>
                  <div className="pt-more">
                    <button
                      type="button"
                      className="pt-icon-btn is-quiet"
                      aria-label={`More for ${item.name}`}
                      aria-expanded={menu === item.id}
                      onClick={() => setMenu((m) => (m === item.id ? null : item.id))}
                    >
                      <i className="fa-solid fa-ellipsis" aria-hidden="true" />
                    </button>
                    {menu === item.id && (
                      <div className="pt-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => dismissFromMenu(item.id, "snooze")}>
                          Not this week
                        </button>
                        <button type="button" role="menuitem" onClick={() => dismissFromMenu(item.id, "archive")}>
                          {item.qty > 0 ? "Stop tracking it" : "Don't need it any more"}
                        </button>
                      </div>
                    )}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ))}

      {extras.length > 0 && (
        <section className="pt-group">
          <h3 className="pt-group-head">
            <span className="pt-num">{String(sections.length + 1).padStart(2, "0")}</span>
            Also
            <span className="pt-group-count">{extras.length}</span>
          </h3>
          <ul className="pt-rows">
            <AnimatePresence initial={false}>
              {extras.map((extra) => (
                <motion.li key={`x${extra.id}`} className="pt-row pt-list-row" {...rowMotion}>
                  <button type="button" className="pt-check" onClick={() => doneExtra(extra)} aria-label={`Got ${extra.name}`}>
                    <i className="fa-solid fa-check" aria-hidden="true" />
                  </button>
                  <span className="pt-row-main is-static">
                    <span className="pt-row-name">{extra.name}</span>
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}
    </div>
  );
};

function listMeta(item, today) {
  const s = item.status;
  if (s.state === "due") {
    return `Usually every ${s.cadence} days · last ${agoText(item.lastBoughtOn, today)}`;
  }
  const bits = [s.state === "out" ? "none left" : `${qtyText(item.qty)} left`];
  if (item.unitCents != null) bits.push(`~${money(item.unitCents)}`);
  return bits.join(" · ");
}

export default ListView;
