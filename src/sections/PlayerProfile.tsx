import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useClub } from "../ClubContext.ts";
import { gbp, winRate, type Member } from "../data.ts";
import { getStats, type ClubStats, type PlayerStat } from "../api.ts";
import LineChart from "../components/LineChart.tsx";
import BarChart, { type BarDatum } from "../components/BarChart.tsx";

const pnlClass = (n: number) => (n >= 0 ? "pos" : "neg");

export default function PlayerProfile() {
  const { id = "" } = useParams();
  const { members } = useClub();
  const [stats, setStats] = useState<ClubStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getStats()
      .then((s) => active && (setStats(s), setLoading(false)))
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const member: Member | undefined = members.find((m) => m.id === id);
  const player: PlayerStat | undefined = stats?.players.find((p) => p.id === id);
  const name = member?.name ?? player?.name ?? "Player";

  // The player's own line through the timeline (cumulative net = their stack).
  const series = useMemo(
    () => stats?.timeline.series.filter((s) => s.id === id) ?? [],
    [stats, id]
  );
  const labels = useMemo(
    () =>
      stats?.timeline.tournaments.map((t) =>
        new Date(t.date).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
      ) ?? [],
    [stats]
  );

  // Bar chart: their running stack at each tournament along the timeline.
  const stackBars: BarDatum[] = useMemo(() => {
    const pts = series[0]?.points ?? [];
    return pts.map((p, i) => ({
      id: String(i),
      label: stats?.timeline.tournaments[i]?.name ?? labels[i] ?? `#${i + 1}`,
      value: p.y,
    }));
  }, [series, stats, labels]);

  // Their podium finishes by tournament.
  const podiumHits = useMemo(() => {
    if (!stats || !member) return [] as { game: string; date: string; place: string }[];
    const out: { game: string; date: string; place: string }[] = [];
    for (const g of stats.podium) {
      let place = "";
      if (g.first === member.name) place = "🥇 1st";
      else if (g.second === member.name) place = "🥈 2nd";
      else if (g.third === member.name) place = "🥉 3rd";
      if (place) out.push({ game: g.name, date: g.date, place });
    }
    return out;
  }, [stats, member]);

  // A trophy for every first-place finish (game won).
  const winTrophies = useMemo(() => {
    if (!stats || !member) return [] as { id: string; label: string; date: string }[];
    return stats.podium
      .filter((g) => g.first === member.name)
      .map((g) => ({ id: `win-${g.id}`, label: g.name, date: g.date }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [stats, member]);

  return (
    <section className="section" id="player">
      <div className="section-inner">
        <Link to="/members" className="back-link">
          ‹ Back to members
        </Link>
        <h2 className="section-title">{name}</h2>
        {member && (
          <p className="section-sub">
            {member.nickname ? `“${member.nickname}” · ` : ""}
            {member.location} · since {member.joined}
          </p>
        )}

        {loading && <p className="stats-loading">Crunching the numbers…</p>}

        {player && (
          <div className="stats-summary">
            <Sum label="Net stack" value={gbp(player.net)} cls={pnlClass(player.net)} />
            <Sum label="Games" value={String(player.games)} />
            <Sum label="🥇 / 🥈 / 🥉" value={`${player.firsts} / ${player.seconds} / ${player.thirds}`} />
            <Sum label="Win rate" value={member ? `${winRate(member)}%` : `${player.wins}`} />
          </div>
        )}

        {member && (
          <div className="stats-block">
            <h3 className="stats-heading">Trophy cabinet</h3>
            {winTrophies.length > 0 || member.trophies.length > 0 ? (
              <div className="trophy-row">
                {winTrophies.map((t) => (
                  <span
                    className="trophy"
                    key={t.id}
                    title={`1st place — ${t.label} · ${new Date(t.date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}`}
                  >
                    <span className="trophy-emoji">🏆</span>
                    {t.label}
                  </span>
                ))}
                {member.trophies.map((t) => (
                  <span className="trophy" key={t.id} title={t.label}>
                    <span className="trophy-emoji">{t.emoji}</span>
                    {t.label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="stats-note">No trophies yet — there's still time.</p>
            )}
          </div>
        )}

        <div className="stats-block">
          <h3 className="stats-heading">Stack over time</h3>
          {stackBars.length > 0 ? (
            <BarChart items={stackBars} yMax={10000} />
          ) : (
            <p className="stats-note">No completed games recorded yet.</p>
          )}
        </div>

        <div className="stats-block">
          <h3 className="stats-heading">Cumulative win / loss</h3>
          {series.length > 0 && labels.length > 0 ? (
            <LineChart labels={labels} series={series} />
          ) : (
            <p className="stats-note">Not enough completed tournaments yet.</p>
          )}
        </div>

        <div className="stats-block">
          <h3 className="stats-heading">Podium finishes</h3>
          {podiumHits.length > 0 ? (
            <ul className="podium-hits">
              {podiumHits.map((h, i) => (
                <li key={i}>
                  <span className="podium-place">{h.place}</span>
                  <span className="podium-game">{h.game}</span>
                  <span className="podium-date">
                    {new Date(h.date).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="stats-note">No podium finishes recorded yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Sum({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-value ${cls ?? ""}`}>{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
