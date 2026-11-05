import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import Sheet from "./Sheet";
import * as api from "../api";
import { badgeFor, dayText } from "../format";

/*
 * What to cook from what's here. The use-soon shelf sits on top because
 * that's what the recipes lean on; Claude's ideas are saved server-side, so
 * reopening the tab (on either phone) costs nothing. "We made this" asks
 * what ran low, since a recipe rarely finishes a whole pack.
 */
const CookView = ({ items, saved, today, getToken, onRecipes, onItems, onExtrasChange, say }) => {
  const reduce = useReducedMotion();
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [cooking, setCooking] = useState(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const soon = useMemo(
    () =>
      items
        .filter((i) => i.status.useSoon && i.qty > 0)
        .sort((a, b) => (a.status.useBy < b.status.useBy ? -1 : 1)),
    [items]
  );
  const stocked = items.filter((i) => i.qty > 0 && i.location !== "home").length;

  const suggest = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api.suggestRecipes(getToken, ask);
    setBusy(false);
    if (!result.ok) {
      return setError(
        result.code === "claude_unconfigured"
          ? "Recipe ideas need Claude, which isn't connected yet. Add ANTHROPIC_API_KEY in Vercel."
          : result.error
      );
    }
    onRecipes(result.recipes);
  };

  const addMissing = async (names) => {
    let extras = null;
    for (const name of names) {
      const result = await api.addExtra(getToken, name);
      if (result.ok) extras = result.extras;
    }
    if (extras) {
      onExtrasChange(extras);
      say(names.length === 1 ? `${names[0]} is on the list.` : `${names.length} things are on the list.`);
    }
  };

  return (
    <div className="pt-cook">
      {soon.length > 0 && (
        <section className="pt-soon" aria-labelledby="pt-soon-head">
          <p className="pt-eyebrow" id="pt-soon-head">
            Use these first
          </p>
          <ul className="pt-soon-shelf">
            {soon.map((i) => {
              const badge = badgeFor(i.status);
              return (
                <li key={i.id} className={i.status.expired ? "is-turning" : ""}>
                  <strong>{i.name}</strong>
                  <span>{badge && badge.tone === "soon" && i.status.expired ? "check it" : `by ${dayText(i.status.useBy)}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <form className="pt-ask" onSubmit={suggest}>
        <label className="pt-eyebrow" htmlFor="pt-ask-input">
          What are we in the mood for?
        </label>
        <div className="pt-ask-row">
          <input
            id="pt-ask-input"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder="Quick weeknight, no oven, uses the chicken…"
            maxLength={200}
          />
          <button type="submit" className="pt-btn is-primary" disabled={busy || stocked < 3}>
            {busy ? "Thinking…" : saved ? "New ideas" : "Suggest"}
          </button>
        </div>
        {stocked < 3 && <p className="pt-hint">Add a few things to the pantry first.</p>}
        {error && (
          <p className="pt-error" role="alert">
            {error}
          </p>
        )}
      </form>

      {busy && (
        <div className="pt-recipes" aria-busy="true" aria-label="Thinking up recipes">
          {[0, 1, 2].map((i) => (
            <div key={i} className="pt-recipe is-ghost" style={{ "--i": i }} />
          ))}
        </div>
      )}

      {!busy && saved && saved.recipes && (
        <>
          <p className="pt-hint pt-recipes-when">
            Ideas from {saved.at ? whenText(saved.at) : "earlier"}
            {saved.ask ? ` for “${saved.ask}”` : ""}
          </p>
          <div className="pt-recipes">
            {saved.recipes.map((r, i) => (
              <motion.article
                key={`${saved.at}-${i}`}
                className="pt-recipe"
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : i * 0.06, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <Recipe
                  recipe={r}
                  index={i}
                  byId={byId}
                  onAddMissing={addMissing}
                  onCooked={() => setCooking(r)}
                />
              </motion.article>
            ))}
          </div>
        </>
      )}

      {!busy && !saved && stocked >= 3 && (
        <p className="pt-none">
          Claude looks at what's on the shelves, starts with what needs using, and keeps the shopping to
          three things or fewer.
        </p>
      )}

      <CookedSheet
        recipe={cooking}
        byId={byId}
        getToken={getToken}
        onClose={() => setCooking(null)}
        onDone={(changed) => {
          onItems(changed);
          setCooking(null);
          say(changed.length ? "Pantry updated. Enjoy it." : "Enjoy it.");
        }}
      />
    </div>
  );
};

function whenText(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  return d.toLocaleString("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

const Recipe = ({ recipe, index, byId, onAddMissing, onCooked }) => {
  const [open, setOpen] = useState(false);
  const uses = recipe.uses.map((u) => ({ ...u, item: byId.get(u.itemId) })).filter((u) => u.item);
  return (
    <>
      <header className="pt-recipe-head">
        <span className="pt-num">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h3>{recipe.title}</h3>
          <p className="pt-recipe-meta">
            {[recipe.minutes && `${recipe.minutes} min`, recipe.servings && `serves ${recipe.servings}`, ...recipe.tags]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>
      {recipe.blurb && <p className="pt-recipe-blurb">{recipe.blurb}</p>}
      <ul className="pt-tags" aria-label="From the pantry">
        {uses.map((u) => (
          <li key={u.itemId} className={u.item.status.useSoon ? "is-soon" : "is-have"}>
            {u.item.name}
            {u.amount ? <small> {u.amount}</small> : null}
          </li>
        ))}
      </ul>
      {recipe.missing.length > 0 && (
        <div className="pt-recipe-missing">
          <ul className="pt-tags" aria-label="Still need">
            {recipe.missing.map((m) => (
              <li key={m} className="is-need">
                {m}
              </li>
            ))}
          </ul>
          <button type="button" className="pt-link" onClick={() => onAddMissing(recipe.missing)}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add to list
          </button>
        </div>
      )}
      <div className="pt-recipe-actions">
        <button type="button" className="pt-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide steps" : `Steps (${recipe.steps.length})`}
        </button>
        <button type="button" className="pt-btn is-primary" onClick={onCooked}>
          We made this
        </button>
      </div>
      {open && (
        <ol className="pt-steps">
          {recipe.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
    </>
  );
};

const AFTER = [
  { key: "plenty", label: "Plenty left" },
  { key: "low", label: "Running low" },
  { key: "out", label: "All gone" },
];

const CookedSheet = ({ recipe, byId, getToken, onClose, onDone }) => {
  const [choice, setChoice] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const uses = recipe ? recipe.uses.map((u) => byId.get(u.itemId)).filter(Boolean) : [];

  const submit = async () => {
    setBusy(true);
    setError(null);
    const list = uses.map((i) => ({ id: i.id, op: choice[i.id] || "plenty" }));
    const result = await api.cooked(getToken, list);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setChoice({});
    onDone(result.items);
  };

  return (
    <Sheet open={Boolean(recipe)} onClose={onClose} label="What did it use up?">
      {recipe && (
        <div className="pt-cooked">
          <p className="pt-eyebrow">{recipe.title}</p>
          <h2>What did it use up?</h2>
          <ul>
            {uses.map((i) => (
              <li key={i.id}>
                <span>{i.name}</span>
                <div className="pt-seg is-small" role="radiogroup" aria-label={i.name}>
                  {AFTER.map((a) => {
                    const active = (choice[i.id] || "plenty") === a.key;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={active ? "is-active" : ""}
                        onClick={() => setChoice((c) => ({ ...c, [i.id]: a.key }))}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
          {error && (
            <p className="pt-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="pt-btn is-primary is-wide" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Done"}
          </button>
        </div>
      )}
    </Sheet>
  );
};

export default CookView;
