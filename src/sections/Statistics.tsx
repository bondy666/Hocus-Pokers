import { useEffect, useMemo, useState } from "react";
import { useClub } from "../ClubContext.ts";
import { gbp, type Member, type Tournament } from "../data.ts";
import { getStats, type ClubStats } from "../api.ts";
import LineChart from "../components/LineChart.tsx";

// Build an approximate ClubStats from bundled context data. Only used when the
// /api/stats endpoint is unavailable (e.g. seed mode with the API down) so the
// page still renders something meaningful.
function buildFallback(members: Member[], tournaments: Tournament[]): ClubStats {
  const completed = [...tournaments]
    .filter((t) => t.status === "complete")
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const players = members.map((m) => {
    const totalBuyIn = m.games * 45;
    return {
      id: m.id,
      name: m.name,
      nickname: m.nickname,
      net: m.netPnl,
      games: m.games,
      wins: m.wins,
      totalBuyIn,
      totalCashOut: totalBuyIn + m.netPnl,
      bestFinish: m.wins > 0 ? 1 : null,
      itm: Math.min(m.games, m.wins + Math.round(m.games * 0.25)),
      avgFinish: null,
    };
  });

  const n = Math.max(completed.length, 1);
  const series = members.map((m) => ({
    id: m.id,
    name: m.name,
    points: completed.map((_, i) => ({
      x: i,
      y: Math.round((m.netPnl * (i + 1)) / n),
    })),
  }));

  const yearsMap = new Map<number, Map<string, { name: string; net: number; wins: number }>>();
  for (const t of completed) {
    const yr = new Date(t.date).getFullYear();
    const winner = members.find((m) => m.id === t.winnerId);
    if (!winner) continue;
    if (!yearsMap.has(yr)) yearsMap.set(yr, new Map());
    const row = yearsMap.get(yr)!;
    const cur = row.get(winner.id) ?? { name: winner.name, net: 0, wins: 0 };
    cur.net += t.prizePool;
    cur.wins += 1;
    row.set(winner.id, cur);
  }
  const yearly = [...yearsMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, row]) => ({
      year,
      rows: [...row.entries()]
        .map(([id, v]) => ({ id, name: v.name, net: v.net, games: 0, wins: v.wins }))
        .sort((a, b) => b.net - a.net),
    }));

  const totalBuyIn = players.reduce((s, p) => s + p.totalBuyIn, 0);
  const totalCashOut = players.reduce((s, p) => s + p.totalCashOut, 0);
  const best = [...members].sort((a, b) => b.netPnl - a.netPnl)[0];

  return {
    players,
    yearly,
    timeline: {
      tournaments: completed.map((t) => ({ id: t.id, name: t.name, date: t.date })),
      series,
    },
    totals: {
      totalBuyIn,
      totalCashOut,
      totalNet: totalCashOut - totalBuyIn,
      tournaments: tournaments.length,
      biggestWin: best ? { name: best.name, amount: best.netPnl } : null,
    },
  };
}

const pnlClass = (n: number) => (n >= 0 ? "pos" : "neg");

export default function Statistics() {
  const { members, tournaments } = useClub();
  const [stats, setStats] = useState<ClubStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getStats()
      .then((s) => {
        if (active) {
          setStats(s);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setStats(buildFallback(members, tournaments));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [members, tournaments]);

  const labels = useMemo(
    () =>
      stats?.timeline.tournaments.map((t) =>
        new Date(t.date).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
      ) ?? [],
    [stats]
  );

  const rankedPlayers = useMemo(
    () => (stats ? [...stats.players].sort((a, b) => b.net - a.net) : []),
    [stats]
  );

  return (
    <section className="section" id="stats">
      <div className="section-inner">
        <h2 className="section-title">Club Statistics</h2>
        <p className="section-sub">
          Career P&amp;L, buy-ins, finishes and yearly standings across the felt.
        </p>

        {loading && <p className="stats-loading">Crunching the numbers…</p>}

        {stats && (
          <>
            <div className="stats-summary">
              <SummaryCard label="Total buy-ins tracked" value={gbp(stats.totals.totalBuyIn)} />
              <SummaryCard label="Total cashed out" value={gbp(stats.totals.totalCashOut)} />
              <SummaryCard
                label="Tournaments"
                value={String(stats.totals.tournaments)}
              />
              <SummaryCard
                label="Biggest career stack"
                value={
                  stats.totals.biggestWin
                    ? `${stats.totals.biggestWin.name.split(" ")[0]} · ${gbp(
                        stats.totals.biggestWin.amount
                      )}`
                    : "—"
                }
              />
            </div>

            <div className="stats-block">
              <h3 className="stats-heading">Win / loss over time</h3>
              <p className="stats-note">
                Cumulative net P&amp;L per player. Tap a name to show or hide their line.
              </p>
              {stats.timeline.series.length > 0 && labels.length > 0 ? (
                <LineChart labels={labels} series={stats.timeline.series} />
              ) : (
                <p className="stats-note">Not enough completed tournaments yet.</p>
              )}
            </div>

            <div className="stats-block">
              <h3 className="stats-heading">Career ledger</h3>
              <div className="table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th className="num">Net P&amp;L</th>
                      <th className="num">Buy-ins</th>
                      <th className="num">Cashed out</th>
                      <th className="num">Games</th>
                      <th className="num">Wins</th>
                      <th className="num">ITM</th>
                      <th className="num">Best</th>
                      <th className="num">Avg finish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedPlayers.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td className={`num ${pnlClass(p.net)}`}>{gbp(p.net)}</td>
                        <td className="num">{gbp(p.totalBuyIn)}</td>
                        <td className="num">{gbp(p.totalCashOut)}</td>
                        <td className="num">{p.games}</td>
                        <td className="num">{p.wins}</td>
                        <td className="num">{p.itm}</td>
                        <td className="num">{p.bestFinish ?? "—"}</td>
                        <td className="num">
                          {p.avgFinish != null ? p.avgFinish.toFixed(1) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {stats.yearly.length > 0 && (
              <div className="stats-block">
                <h3 className="stats-heading">Yearly standings</h3>
                <div className="year-grid">
                  {stats.yearly.map((y) => (
                    <div className="year-card" key={y.year}>
                      <div className="year-title">{y.year}</div>
                      <ol className="year-list">
                        {y.rows.slice(0, 5).map((r, i) => (
                          <li key={r.id}>
                            <span className="year-rank">{i + 1}</span>
                            <span className="year-name">{r.name}</span>
                            <span className={`year-net ${pnlClass(r.net)}`}>{gbp(r.net)}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
