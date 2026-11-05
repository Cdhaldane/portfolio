import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth, UserButton } from "@clerk/clerk-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import * as api from "./api";
import { dayText, stepQty } from "./format";
import StockView from "./parts/StockView";
import ListView from "./parts/ListView";
import CookView from "./parts/CookView";
import MoreView from "./parts/MoreView";
import ItemSheet from "./parts/ItemSheet";
import ReceiptFlow from "./parts/ReceiptFlow";
import "./Pantry.css";

/*
 * /pantry: the household's kitchen. Receipts fill it, quick taps keep it
 * honest, and it says what's running low and what to cook.
 *
 * Owns the one piece of server state (GET /api/pantry). Every item arrives
 * with its status already worked out by the server (api/_lib/pantry-stock.js),
 * so the views only filter and display; a change returns the updated item,
 * which is merged in place.
 *
 * The tab lives in the URL (?tab=list) so a reminder can open the list.
 */
const TABS = [
  { key: "stock", label: "Stock", icon: "fa-jar" },
  { key: "list", label: "List", icon: "fa-list-check" },
  { key: "cook", label: "Cook", icon: "fa-utensils" },
  { key: "more", label: "More", icon: "fa-ellipsis" },
];
const TOAST_MS = 3200;

const byName = (a, b) => a.name.localeCompare(b.name);

const Pantry = () => {
  const { getToken } = useAuth();
  const reduce = useReducedMotion();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "stock";
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [pending, setPending] = useState(() => new Set());
  const [sheet, setSheet] = useState(null); // { id } | { preset }
  const [scanning, setScanning] = useState(false);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(async () => {
    const result = await api.loadPantry(getToken);
    if (result.ok) {
      setData(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, [getToken]);

  useEffect(() => {
    refresh();
    // The other person may have changed things while this tab slept.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const say = useCallback((text) => setToast({ id: Date.now(), text }), []);

  const setTab = (key) => {
    const next = new URLSearchParams(params);
    if (key === "stock") next.delete("tab");
    else next.set("tab", key);
    setParams(next, { replace: true });
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const mergeItems = useCallback((changed) => {
    setData((d) => {
      if (!d) return d;
      const map = new Map(d.items.map((i) => [i.id, i]));
      for (const item of changed) {
        if (item.archived) map.delete(item.id);
        else map.set(item.id, item);
      }
      return { ...d, items: [...map.values()].sort(byName) };
    });
  }, []);

  const applySnapshot = useCallback((snap) => {
    setData((d) => ({
      ...d,
      today: snap.today,
      items: snap.items,
      extras: snap.extras,
      receipts: snap.receipts,
    }));
  }, []);

  const withPending = useCallback(async (id, fn) => {
    setPending((p) => new Set(p).add(id));
    try {
      return await fn();
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(id);
        return next;
      });
    }
  }, []);

  /** A quick change to one item; returns the updated item or null. */
  const change = useCallback(
    (id, op, qty) =>
      withPending(id, async () => {
        const result = await api.adjust(getToken, id, op, qty);
        if (!result.ok) {
          say(result.error);
          return null;
        }
        mergeItems([result.item]);
        return result.item;
      }),
    [getToken, mergeItems, say, withPending]
  );

  const usedSome = useCallback(
    async (item) => {
      const step = item.qty - stepQty(item.qty, -1);
      const updated = await change(item.id, "use", step);
      if (updated && updated.status.state === "out") say(`${updated.name} is out. It's on the list.`);
      else if (updated && updated.status.state === "low") say(`${updated.name} is running low. It's on the list.`);
    },
    [change, say]
  );

  const dismissItem = useCallback(
    (id, mode) =>
      withPending(id, async () => {
        const result = await api.dismiss(getToken, id, mode);
        if (!result.ok) return say(result.error);
        mergeItems([result.item]);
        say(mode === "archive" ? "Off the list and out of the pantry." : "Off the list for a week.");
      }),
    [getToken, mergeItems, say, withPending]
  );

  const counts = useMemo(() => {
    const items = (data && data.items) || [];
    const listed = items.filter((i) => i.status.onList);
    return {
      list: listed.length + ((data && data.extras.length) || 0),
      out: listed.filter((i) => i.status.state === "out").length,
      low: listed.filter((i) => i.status.state !== "out").length,
      soon: items.filter((i) => i.status.useSoon && i.qty > 0).length,
    };
  }, [data]);

  const sheetItem = sheet && sheet.id ? data && data.items.find((i) => i.id === sheet.id) : null;

  const view = (() => {
    if (!data) {
      return (
        <div className="pt-loading" aria-live="polite">
          {loadError ? (
            <>
              <p>{loadError}</p>
              <button type="button" className="pt-btn" onClick={refresh}>
                Try again
              </button>
            </>
          ) : (
            <div className="pt-shelf-skeleton" aria-label="Opening the pantry">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} style={{ "--i": i }} />
              ))}
            </div>
          )}
        </div>
      );
    }
    if (tab === "list") {
      return (
        <ListView
          items={data.items}
          extras={data.extras}
          today={data.today}
          pending={pending}
          onGot={async (item) => {
            const updated = await change(item.id, "add", 1);
            if (updated) say(`Got ${updated.name}.`);
          }}
          onDismiss={dismissItem}
          onOpen={(id) => setSheet({ id })}
          onExtrasChange={(extras) => setData((d) => ({ ...d, extras }))}
          getToken={getToken}
          say={say}
        />
      );
    }
    if (tab === "cook") {
      return (
        <CookView
          items={data.items}
          saved={data.recipes}
          today={data.today}
          getToken={getToken}
          onRecipes={(recipes) => setData((d) => ({ ...d, recipes }))}
          onItems={mergeItems}
          onExtrasChange={(extras) => setData((d) => ({ ...d, extras }))}
          say={say}
        />
      );
    }
    if (tab === "more") {
      return (
        <MoreView
          data={data}
          getToken={getToken}
          onSnapshot={applySnapshot}
          say={say}
        />
      );
    }
    return (
      <StockView
        items={data.items}
        today={data.today}
        pending={pending}
        onOpen={(id) => setSheet({ id })}
        onUsedSome={usedSome}
        onAdd={(preset) => setSheet({ preset: preset || {} })}
        onScan={() => setScanning(true)}
      />
    );
  })();

  return (
    <div className="pt">
      <div className="pt-backdrop" aria-hidden="true" />
      <header className="pt-top">
        <div className="pt-brand">
          <p className="pt-date">{data ? dayText(data.today) : " "}</p>
          <h1 className="pt-label">
            <span>Pantry</span>
          </h1>
        </div>
        <UserButton />
      </header>

      {data && data.items.length > 0 && (
        <nav className="pt-pulse" aria-label="At a glance">
          <button type="button" className="pt-pulse-cell is-out" onClick={() => setTab("list")}>
            <strong>{counts.out}</strong>
            <span>out</span>
          </button>
          <button type="button" className="pt-pulse-cell is-low" onClick={() => setTab("list")}>
            <strong>{counts.low}</strong>
            <span>low or due</span>
          </button>
          <button type="button" className="pt-pulse-cell is-soon" onClick={() => setTab("cook")}>
            <strong>{counts.soon}</strong>
            <span>use soon</span>
          </button>
        </nav>
      )}

      <main className="pt-main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={data ? tab : "loading"}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            {view}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="pt-tabs" aria-label="Pantry sections">
        {TABS.slice(0, 2).map((t) => (
          <TabButton key={t.key} t={t} active={tab === t.key} onClick={() => setTab(t.key)} badge={t.key === "list" ? counts.list : 0} />
        ))}
        <button type="button" className="pt-scan" onClick={() => setScanning(true)} aria-label="Scan a receipt">
          <span className="pt-scan-ring" aria-hidden="true" />
          <i className="fa-solid fa-receipt" aria-hidden="true" />
        </button>
        {TABS.slice(2).map((t) => (
          <TabButton key={t.key} t={t} active={tab === t.key} onClick={() => setTab(t.key)} />
        ))}
      </nav>

      {data && (
        <ItemSheet
          open={Boolean(sheet)}
          item={sheetItem}
          preset={sheet && sheet.preset}
          today={data.today}
          pending={sheetItem ? pending.has(sheetItem.id) : false}
          getToken={getToken}
          onClose={() => setSheet(null)}
          onChange={change}
          onSaved={(item) => {
            mergeItems([item]);
            setSheet(null);
            say(sheet && sheet.preset ? `Added ${item.name}.` : "Saved.");
          }}
          onDeleted={(snap, name) => {
            applySnapshot(snap);
            setSheet(null);
            say(`${name} is gone.`);
          }}
          say={say}
        />
      )}

      {data && (
        <ReceiptFlow
          open={scanning}
          items={data.items}
          today={data.today}
          getToken={getToken}
          onClose={() => setScanning(false)}
          onSaved={(snap) => applySnapshot(snap)}
        />
      )}

      <div className="pt-toast-slot" aria-live="polite">
        <AnimatePresence>
          {toast && (
            <motion.p
              key={toast.id}
              className="pt-toast"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reduce ? 0 : 8 }}
              transition={{ type: "spring", damping: 26, stiffness: 380 }}
            >
              {toast.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const TabButton = ({ t, active, onClick, badge = 0 }) => (
  <button
    type="button"
    className={`pt-tab${active ? " is-active" : ""}`}
    onClick={onClick}
    aria-current={active ? "page" : undefined}
  >
    <span className="pt-tab-icon">
      <i className={`fa-solid ${t.icon}`} aria-hidden="true" />
      {badge > 0 && <span className="pt-tab-badge">{badge > 99 ? "99+" : badge}</span>}
    </span>
    <span className="pt-tab-label">{t.label}</span>
  </button>
);

export default Pantry;
