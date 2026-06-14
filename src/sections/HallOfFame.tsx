import { Link } from "react-router-dom";
import { useClub } from "../ClubContext.ts";
import { buildHallOfFame } from "../hallOfFame.ts";

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const medal = ["🥇", "🥈", "🥉"];

export default function HallOfFame() {
  const { members, tournaments } = useClub();
  const hof = buildHallOfFame(members, tournaments);

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
            {hof.champions.slice(0, 3).map((c, i) => (
              <div className={`hof-podium-card place-${i + 1}`} key={c.id}>
                <div className="hof-podium-medal">{medal[i]}</div>
                <div className="hof-podium-name">{playerLink(c.id, c.name)}</div>
                <div className="hof-podium-wins">{c.wins} wins</div>
              </div>
            ))}
          </div>
          {hof.champions.length > 3 && (
            <table className="hof-table">
              <tbody>
                {hof.champions.slice(3).map((c, i) => (
                  <tr key={c.id}>
                    <td className="hof-rank">{i + 4}</td>
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
                  {hof.droughts.slice(0, 8).map((d) => (
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
              <p className="hof-empty">No host data yet — add hosts in Score Keeper.</p>
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
            <p className="hof-note">Based on games won or hosted.</p>
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
