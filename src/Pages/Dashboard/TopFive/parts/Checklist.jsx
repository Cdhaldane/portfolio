import { CARDS_PER_PACK, rarityOf } from "../top5.data";

/*
 * The flat, readable view of every pick, like the checklist card a real set
 * ships with. Spoiler-safe: unopened packs stay "? ? ?" unless you ask.
 */
export default function Checklist({ packs, opened, spoiled, onSpoil, onOpen }) {
  const anyHidden = packs.some((p) => !opened[p.id]);
  const legends = packs.filter((p) => opened[p.id] || spoiled);

  return (
    <section className="td-section" id="td-checklist" aria-labelledby="td-checklist-h">
      <h2 className="td-sec-h" id="td-checklist-h">
        <span className="td-sec-n" aria-hidden="true">03</span>
        Set checklist
      </h2>
      <p className="td-sec-note">Every pick, flat. Unopened packs stay secret (unless you're a spoiler).</p>

      {legends.length ? (
        <div className="td-legends">
          <h3 className="td-legends-h">
            <i className="fa-solid fa-crown" aria-hidden="true" /> Hall of Legends
          </h3>
          <ul>
            {legends.map((p) => (
              <li key={p.id} style={{ "--h": p.hue }}>
                <span className="td-mono">{p.name}</span>
                <b>{p.cards[0].title}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="td-check-grid">
        {packs.map((p) => {
          const open = Boolean(opened[p.id]) || spoiled;
          return (
            <article key={p.id} className={`td-check-pack ${open ? "is-open" : ""}`} style={{ "--h": p.hue }}>
              <h3>
                <span className="td-check-emblem" aria-hidden="true">
                  <i className={`fa-solid ${p.icon}`} />
                </span>
                {p.name}
                <span className="td-mono">
                  {opened[p.id] ? CARDS_PER_PACK : 0}/{CARDS_PER_PACK}
                </span>
              </h3>
              <ol>
                {p.cards.map((c, k) => {
                  const r = rarityOf(k + 1);
                  return (
                    <li key={c.id} className={`td-check-row td-tier-${r.tier}`}>
                      <i className={`fa-solid ${r.symbol} td-check-sym`} aria-hidden="true" />
                      <span className="td-check-rank">#{k + 1}</span>
                      {open ? (
                        <span>{c.title}</span>
                      ) : (
                        <span className="td-check-hidden">
                          <span aria-hidden="true">? ? ?</span>
                          <span className="td-sr">Hidden until opened</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
              {!open ? (
                <button type="button" className="td-tbtn td-check-open" onClick={() => onOpen(p.id)}>
                  <i className="fa-solid fa-scissors" aria-hidden="true" />
                  <span>Rip to reveal</span>
                </button>
              ) : null}
            </article>
          );
        })}
      </div>

      {anyHidden && !spoiled ? (
        <button type="button" className="td-tbtn td-spoil" onClick={onSpoil}>
          <i className="fa-solid fa-eye" aria-hidden="true" />
          <span>Spoil it for me</span>
        </button>
      ) : null}
    </section>
  );
}
