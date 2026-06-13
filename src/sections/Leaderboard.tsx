import { leaderboard, gbp, winRate } from "../data.ts";
import { useClub } from "../ClubContext.ts";

export default function Leaderboard() {
  const { members } = useClub();
  const rows = leaderboard(members);

  return (
    <section className="section felt" id="leaderboard">
      <div className="section-inner">
        <h2 className="section-title">Career Leaderboard</h2>
        <p className="section-sub">Net profit &amp; loss across every tracked tournament.</p>

        <div className="table-wrap">
          <table className="board">
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th>Player</th>
                <th className="num">Net P&amp;L</th>
                <th className="num">Wins</th>
                <th className="num">Games</th>
                <th className="num">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => (
                <tr key={m.id} className={i === 0 ? "leader" : ""}>
                  <td className="col-rank">
                    {i === 0 ? "♛" : i + 1}
                  </td>
                  <td>
                    <span className="player-name">{m.name}</span>
                    <span className="player-nick">“{m.nickname}”</span>
                  </td>
                  <td className={`num ${m.netPnl >= 0 ? "pos" : "neg"}`}>
                    {gbp(m.netPnl)}
                  </td>
                  <td className="num">{m.wins}</td>
                  <td className="num">{m.games}</td>
                  <td className="num">{winRate(m)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
