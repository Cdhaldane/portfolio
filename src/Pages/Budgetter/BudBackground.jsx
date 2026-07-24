import "./BudBackground.css";

/*
 * Ambient background shared by every Budgetter surface (app, gate, preview).
 * Ledger grid + signature blue→sage→coral aurora + grain, all fixed to the
 * viewport so scrolling content glides over it. Purely decorative.
 */
const BudBackground = () => (
  <div className="bud-bg" aria-hidden="true">
    <span className="bud-bg-grid" />
    <span className="bud-bg-blob bud-bg-blob--blue" />
    <span className="bud-bg-blob bud-bg-blob--sage" />
    <span className="bud-bg-blob bud-bg-blob--coral" />
    <span className="bud-bg-grain" />
  </div>
);

export default BudBackground;
