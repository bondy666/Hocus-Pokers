import {
  venue,
  venueLine,
  nextScheduleLine,
  gbp,
  winnerName,
  type Tournament,
  type Member,
} from "../data.ts";
import { useClub } from "../ClubContext.ts";
import BanterBox from "../components/BanterBox.tsx";
import NotificationToggle from "../components/NotificationToggle.tsx";

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function CardRoom() {
  const { tournaments, members } = useClub();

  const todayIso = new Date().toISOString().slice(0, 10);

  // Next up: a live tournament, otherwise the soonest upcoming/future date.
  const upcoming = [...tournaments]
    .filter((t) => t.status !== "complete")
    .filter((t) => t.status === "live" || t.status === "upcoming" || t.date >= todayIso)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = upcoming.find((t) => t.status === "live") ?? upcoming[0] ?? null;

  // Last one: the most recent completed (or past) tournament.
  const previous =
    [...tournaments]
      .filter((t) => t.status === "complete" || t.date < todayIso)
      .filter((t) => t.id !== next?.id)
      .sort((a, b) => (a.date > b.date ? -1 : 1))[0] ?? null;

  const details = [
    {
      label: "Address",
      value: next ? venueLine(next) : "Set on each tournament — see Tournaments",
      icon: "📍",
    },
    { label: "Schedule", value: nextScheduleLine(tournaments), icon: "🗓️" },
    { label: "Buy-in format", value: venue.buyIn, icon: "💷" },
  ];

  return (
    <section className="section" id="cardroom">
      <div className="section-inner">
        <h2 className="section-title">The Card Room</h2>
        <p className="section-sub">Where the chips hit the felt.</p>

        <div className="cardroom-panel felt">
          <h3 className="cardroom-name">{venue.name}</h3>
          <dl className="cardroom-details">
            {details.map((d) => (
              <div className="cardroom-row" key={d.label}>
                <dt>
                  <span className="cardroom-icon">{d.icon}</span>
                  {d.label}
                </dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="cardroom-schedule">
          <NightCard kind="next" tournament={next} members={members} />
          <NightCard kind="previous" tournament={previous} members={members} />
        </div>

        <NotificationToggle />

        <BanterBox />
      </div>
    </section>
  );
}

function NightCard({
  kind,
  tournament,
  members,
}: {
  kind: "next" | "previous";
  tournament: Tournament | null;
  members: Member[];
}) {
  const heading = kind === "next" ? "Next tournament" : "Previous tournament";

  if (!tournament) {
    return (
      <div className={`night-card ${kind}`}>
        <span className="night-kicker">{heading}</span>
        <p className="night-empty">
          {kind === "next"
            ? "Nothing scheduled yet — head to Plan Night to pick a date."
            : "No completed tournaments yet."}
        </p>
      </div>
    );
  }

  const isLive = tournament.status === "live";

  return (
    <div className={`night-card ${kind}`}>
      <span className="night-kicker">
        {heading}
        {isLive && <span className="night-live"> · Live now</span>}
      </span>
      <h4 className="night-name">{tournament.name}</h4>
      <p className="night-date">{formatDate(tournament.date)}</p>
      <p className="night-venue">{tournament.venue}</p>
      {tournament.address && <p className="night-address">{tournament.address}</p>}
      <div className="night-stats">
        <div>
          <span className="night-val">{tournament.players}</span>
          <span className="night-lbl">Players</span>
        </div>
        <div>
          <span className="night-val">{gbp(tournament.prizePool)}</span>
          <span className="night-lbl">Prize pool</span>
        </div>
        {kind === "previous" && (
          <div>
            <span className="night-val">{winnerName(members, tournament.winnerId)}</span>
            <span className="night-lbl">Winner</span>
          </div>
        )}
      </div>
    </div>
  );
}
