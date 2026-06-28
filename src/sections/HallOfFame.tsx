import { Link } from "react-router-dom";
import { useClub } from "../ClubContext.ts";
import { buildHallOfFame } from "../hallOfFame.ts";

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const medal = ["🥇", "🥈", "🥉"];

export default function HallOfFame() {
  const { members, tournaments } = useClub();
  const hof = buildHallOfFame(members, tournaments);

  // Group champions into podium tiers by trophy count so everyone on an equal
  // win total shares the same podium step (and the same medal). We show the top
  // three distinct trophy counts; any players beyond that fall to the table.
  const podiumTiers: (typeof hof.champions)[] = [];
  for (const c of hof.champions) {
    const last = podiumTiers[podiumTiers.length - 1];
    if (last && last[0].wins === c.wins) last.push(c);
    else podiumTiers.push([c]);
  }
  const topTiers = podiumTiers.slice(0, 3);
  const podiumIds = new Set(topTiers.flat().map((c) => c.id));
  const restChampions = hof.champions.filter((c) => !podiumIds.has(c.id));

  const playerLink = (id: string | undefined, name: string) =>
    id ? (
      <Link className="player-link" to={`/player/${id}`}>
        {name}
      </Link>
    ) : (
      <span>{name}</span>
    );

  return (
    <section className="section felt" id="halloffame">
      <div className="section-inner">
        <h2 className="section-title">Hall of Fame</h2>
        <p className="section-sub">
          {hof.totalGames} games of glory, droughts and back-to-back heroics.
        </p>

        {/* Champions podium */}
        <div className="hof-block">
          <h3 className="hof-title">🏆 Champions</h3>
          <div className="hof-podium">
            {topTiers.map((tier, i) => (
              <div className={`hof-podium-card place-${i + 1}`} key={tier[0].wins}>
                <div className="hof-podium-medal">{medal[i]}</div>
                <div className="hof-podium-name">
                  {tier.length === 1 ? (
                    playerLink(tier[0].id, tier[0].name)
                  ) : (
                    <ul className="hof-podium-list">
                      {tier.map((c) => (
                        <li key={c.id}>{playerLink(c.id, c.name)}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="hof-podium-wins">{tier[0].wins} wins</div>
              </div>
            ))}
          </div>
          {restChampions.length > 0 && (
            <table className="hof-table">
              <tbody>
                {restChampions.map((c) => (
                  <tr key={c.id}>
                    <td className="hof-rank">{c.rank}</td>
                    <td>{playerLink(c.id, c.name)}</td>
                    <td className="num">{c.wins} wins</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="hof-grid">
          {/* Win streaks */}
          <div className="hof-block">
            <h3 className="hof-title">🔥 Win streaks</h3>
            <p className="hof-note">Longest run of back-to-back titles.</p>
            {hof.streaks.length === 0 ? (
              <p className="hof-empty">No back-to-back wins yet.</p>
            ) : (
              <table className="hof-table">
                <tbody>
                  {hof.streaks.map((s) => (
                    <tr key={s.id}>
                      <td>{playerLink(s.id, s.name)}</td>
                      <td className="num">{s.streak} in a row</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Longest droughts */}
          <div className="hof-block">
            <h3 className="hof-title">🏜️ Longest droughts</h3>
            <p className="hof-note">Most games between wins (current run in brackets).</p>
            {hof.droughts.length === 0 ? (
              <p className="hof-empty">No wins recorded yet.</p>
            ) : (
              <table className="hof-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="num">Longest</th>
                    <th className="num">Current</th>
                  </tr>
                </thead>
                <tbody>
                  {hof.droughts.map((d) => (
                    <tr key={d.id}>
                      <td>{playerLink(d.id, d.name)}</td>
                      <td className="num">{d.longest}</td>
                      <td className="num">{d.current}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Hosts leaderboard */}
          <div className="hof-block">
            <h3 className="hof-title">🏠 Hosts leaderboard</h3>
            <p className="hof-note">Who's put the felt out most often.</p>
            {hof.hosts.length === 0 ? (
              <p className="hof-empty">No host data yet — set a game's host on the Tournaments page.</p>
            ) : (
              <table className="hof-table">
                <tbody>
                  {hof.hosts.map((h) => (
                    <tr key={h.id}>
                      <td>{playerLink(h.id, h.name)}</td>
                      <td className="num">{h.hosted} nights</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Trophy defences */}
          <div className="hof-block">
            <h3 className="hof-title">🛡️ Trophy defences</h3>
            <p className="hof-note">Reigning champs defending the title next game.</p>
            {hof.defences.length === 0 ? (
              <p className="hof-empty">No defences yet.</p>
            ) : (
              <table className="hof-table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th className="num">Defended</th>
                    <th className="num">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {hof.defences.slice(0, 8).map((d) => (
                    <tr key={d.id}>
                      <td>{playerLink(d.id, d.name)}</td>
                      <td className="num">{d.successes}</td>
                      <td className="num">{d.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* First / last appearance */}
          <div className="hof-block hof-wide">
            <h3 className="hof-title">📅 First &amp; last appearance</h3>
            <p className="hof-note">Based on games attended, won or hosted.</p>
            <table className="hof-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>First</th>
                  <th>Last</th>
                  <th className="num">Span</th>
                </tr>
              </thead>
              <tbody>
                {hof.appearances.map((a) => (
                  <tr key={a.id}>
                    <td>{playerLink(a.id, a.name)}</td>
                    <td>{fmtDate(a.first)}</td>
                    <td>{fmtDate(a.last)}</td>
                    <td className="num">{a.span ? `${a.span} yr${a.span > 1 ? "s" : ""}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Trophy timeline */}
        <div className="hof-block">
          <h3 className="hof-title">🗓️ Trophy timeline</h3>
          <p className="hof-note">Every champion, newest first.</p>
          <ol className="hof-timeline">
            {hof.timeline.map((t) => (
              <li className="hof-timeline-row" key={t.id}>
                <span className="hof-timeline-date">{fmtDate(t.date)}</span>
                <span className="hof-timeline-winner">
                  {t.winnerId ? (
                    <>
                      🏆 {playerLink(t.winnerId, t.winnerName)}
                      {t.defence === "defended" && (
                        <span className="hof-badge defended">defended</span>
                      )}
                      {t.defence === "first" && <span className="hof-badge first">first cup</span>}
                    </>
                  ) : (
                    <span className="hof-tbd">winner TBC</span>
                  )}
                </span>
                {t.hostId && <span className="hof-timeline-host">🏠 {t.hostName}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
