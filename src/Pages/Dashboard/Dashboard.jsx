import React from "react";
import { Link } from "react-router-dom";
import "./Dashboard.css";

/*
 * Hidden ops console — a private directory of small projects hosted under the
 * one personal domain. Reachable at /dashboard, unlinked from public nav.
 * Add a node here as each project comes online.
 */
const NODES = [
  {
    id: "imposter",
    name: "Word Imposter",
    tag: "PARTY · LOCAL",
    icon: "fa-user-secret",
    desc: "Pass-the-phone social deduction. Pick a category, deal secret roles, hunt the imposter.",
    to: "/dashboard/imposter",
    status: "online",
  },
];

const Dashboard = () => {
  const online = NODES.filter((n) => n.status === "online").length;

  return (
    <div className="dash">
      <div className="dash-scan" aria-hidden="true" />
      <div className="dash-grid-bg" aria-hidden="true" />

      <div className="dash-inner">
        <header className="dash-head">
          <div className="dash-head-main">
            <span className="dash-kicker">
              <span className="dash-led" /> PRIVATE NODE · ACCESS GRANTED
            </span>
            <h1 className="dash-title">
              OPS<span>{"//"}</span>CONSOLE
            </h1>
            <p className="dash-sub">
              Personal directory of small projects. Internal use only.
            </p>
          </div>
          <Link to="/" className="dash-exit">
            <i className="fa-solid fa-power-off" />
            <span>EXIT</span>
          </Link>
        </header>

        <div className="dash-stats">
          <div className="dash-stat">
            <span className="dash-stat-val">{NODES.length}</span>
            <span className="dash-stat-label">NODES</span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-val dash-stat-val--green">{online}</span>
            <span className="dash-stat-label">ONLINE</span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-val">v0.1</span>
            <span className="dash-stat-label">BUILD</span>
          </div>
        </div>

        <section className="dash-nodes">
          {NODES.map((n) => (
            <Link key={n.id} to={n.to} className="dash-node">
              <span className="dash-node-corner dash-node-corner--tl" />
              <span className="dash-node-corner dash-node-corner--br" />

              <div className="dash-node-top">
                <span className="dash-node-icon">
                  <i className={`fa-solid ${n.icon}`} />
                </span>
                <span className={`dash-node-status status-${n.status}`}>
                  <span className="dash-led dash-led--green" /> {n.status}
                </span>
              </div>

              <h2 className="dash-node-name">{n.name}</h2>
              <span className="dash-node-tag">{n.tag}</span>
              <p className="dash-node-desc">{n.desc}</p>

              <span className="dash-node-launch">
                LAUNCH <i className="fa-solid fa-angles-right" />
              </span>
            </Link>
          ))}

          {/* Empty slot placeholders — more projects dock here over time. */}
          <div className="dash-node dash-node--empty" aria-hidden="true">
            <i className="fa-solid fa-plus" />
            <span>SLOT OPEN</span>
          </div>
        </section>

        <footer className="dash-foot">
          <span>CHARLIE HALDANE</span>
          <span className="dash-foot-mono">{`// ${NODES.length} module(s) mounted`}</span>
        </footer>
      </div>
    </div>
  );
};

export default Dashboard;
