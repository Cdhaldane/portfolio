import { SECRETS } from "../top5.data";

/** Five face-down secret rares; each flips face-up once its egg is found. */
export default function SecretsRow({ found }) {
  return (
    <section className="td-section" aria-labelledby="td-secrets-h">
      <h2 className="td-sec-h" id="td-secrets-h">
        <span className="td-sec-n" aria-hidden="true">02</span>
        Secret rares
        <span className="td-mono">
          {found.length}/{SECRETS.length}
        </span>
      </h2>
      <ul className="td-secrets">
        {SECRETS.map((s) => {
          const got = found.includes(s.id);
          return (
            <li key={s.id} className={`td-secret ${got ? "is-found" : ""}`}>
              <div className="td-secret-in td-3d">
                <div className="td-secret-face td-secret-face--hint" aria-hidden={got}>
                  <i className="fa-solid fa-question" aria-hidden="true" />
                  <span>{s.hint}</span>
                </div>
                <div className="td-secret-face td-secret-face--found" aria-hidden={!got}>
                  <i className={`fa-solid ${s.icon}`} aria-hidden="true" />
                  <b>{s.label}</b>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
