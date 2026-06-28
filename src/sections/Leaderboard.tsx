import { Link } from "react-router-dom";
import { leaderboard, gbp, winRate } from "../data.ts";
import { useClub } from "../ClubContext.ts";

export default function Leaderboard() {
  const { members } = useClub();
  const rows = leaderboard(members);
  // Everyone tied on the most wins shares the crown (and a "tied" tag when
  // more than one player is on top).
  const topWins = rows[0]?.wins ?? 0;
  const leaderCount = rows.filter((m) => m.wins === topWins && topWins > 0).length;
  const isTied = leaderCount > 1;

  return (
    <section className="section felt" id="leaderboard">
      <div className="section-inner">
        <h2 className="section-title">Career Leaderboard</h2>
        <p className="section-sub">
          Ranked by wins across trophy games — the first game of each night with 6+ registered members.
        </p>

        <div className="table-wrap">
          <table className="board">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th>Player</th>
                <th className="num">Wins</th>
                <th className="num">Games</th>
                <th className="num">Win rate</th>
                <th className="num">Net P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => {
                const isLeader = m.wins === topWins && topWins > 0;
                return (
                  <tr key={m.id} className={isLeader ? "leader" : ""}>
                    <td className="col-rank">
                      {isLeader ? "♛" : i + 1}
                    </td>
                    <td>
                      <Link className="player-link" to={`/player/${m.id}`}>
                        <span className="player-name">{m.name}</span>
                        {m.nickname && <span className="player-nick">“{m.nickname}”</span>}
                        {isLeader && isTied && <span className="tied-tag">Tied</span>}
                      </Link>
                    </td>
                    <td className="num">{m.wins}</td>
                    <td className="num">{m.games}</td>
                    <td className="num">{winRate(m)}%</td>
                    <td className={`num ${m.netPnl >= 0 ? "pos" : "neg"}`}>
                      {gbp(m.netPnl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
