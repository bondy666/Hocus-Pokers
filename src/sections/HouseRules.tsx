import { houseRules } from "../data.ts";

export default function HouseRules() {
  return (
    <section className="section" id="rules">
      <div className="section-inner">
        <h2 className="section-title">House Rules</h2>
        <p className="section-sub">Nine rules. Learn them, live by them.</p>

        <ol className="rules-grid">
          {houseRules.map((r, i) => (
            <li className="rule" key={r.title}>
              <span className="rule-num">{i + 1}</span>
              <h3 className="rule-title">{r.title}</h3>
              <p className="rule-body">{r.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
