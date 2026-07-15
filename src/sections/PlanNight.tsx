import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useClub } from "../ClubContext.ts";
import type { Member } from "../data.ts";
import {
  getPlanning,
  proposeDate,
  voteDate,
  removeDate,
  setupFromDate,
  loginUrl,
  type PlanningDate,
} from "../api.ts";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const prettyDate = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const NAME_ADJECTIVES = [
  "Midnight", "High Roller", "Felt", "Riverboat", "Aces High", "Full House",
  "Royal", "Bounty", "Deepstack", "Big Blind", "Last Longer", "All-In",
  "Pocket Rockets", "Chip Leader", "Dead Man's Hand", "Nut Flush",
];

const NAME_NOUNS = [
  "Freezeout", "Showdown", "Shootout", "Classic", "Brawl", "Rumble",
  "Throwdown", "Special", "Series", "Invitational", "Bonanza", "Bash",
  "Clash", "Deepstack", "Knockout",
];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function randomTournamentName(dateStr: string): string {
  const month = MONTHS[new Date(dateStr).getMonth()];
  const patterns = [
    () => `${month} ${pick(NAME_NOUNS)}`,
    () => `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`,
    () => `The ${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`,
  ];
  return pick(patterns)();
}

export default function PlanNight() {
  const { user, authChecked, refresh, source, members } = useClub();
  const navigate = useNavigate();
  const canWrite = user?.canWrite !== false && !!user;

  const [dates, setDates] = useState<PlanningDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | "new" | null>(null);

  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const load = async () => {
    try {
      const data = await getPlanning();
      setDates(data);
      setErr(null);
    } catch {
      setErr("Couldn't load the planner.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const byIso = useMemo(() => {
    const map = new Map<string, PlanningDate>();
    for (const d of dates) map.set(d.date, d);
    return map;
  }, [dates]);

  const sorted = useMemo(
    () => [...dates].sort((a, b) => (a.date < b.date ? -1 : 1)),
    [dates]
  );

  const leader = useMemo(() => {
    const withVotes = dates.filter((d) => d.voteCount > 0);
    if (withVotes.length === 0) return null;
    return withVotes.sort((a, b) => b.voteCount - a.voteCount || (a.date < b.date ? -1 : 1))[0];
  }, [dates]);

  // ----- calendar grid -----
  const first = new Date(cursor.y, cursor.m, 1);
  const startWeekday = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.y, cursor.m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const todayIso = iso(today);

  const planUrl = "https://hocuspokers.com/plan";
  const whatsappShareUrl = useMemo(() => {
    const lines = ["🃏 Time to plan the next poker night!"];
    if (sorted.length > 0) {
      lines.push("", "Proposed dates so far:");
      for (const d of sorted) {
        lines.push(
          `• ${prettyDate(d.date)} — ${d.voteCount} ${d.voteCount === 1 ? "vote" : "votes"}`
        );
      }
    } else {
      lines.push("", "No dates proposed yet — get in first!");
    }
    lines.push("", `Propose dates and vote here: ${planUrl}`);
    return `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
  }, [sorted, planUrl]);

  const move = (delta: number) =>
    setCursor((c) => {
      const nm = c.m + delta;
      return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
    });

  const handleDayClick = async (d: Date) => {
    const key = iso(d);
    if (key < todayIso) return; // no past dates
    const existing = byIso.get(key);
    if (existing) {
      await handleVote(existing.id);
      return;
    }
    if (!canWrite) return;
    try {
      setBusy("new");
      await proposeDate({ date: key });
      await load();
    } catch (e: any) {
      setErr(e.message || "Couldn't propose that date.");
    } finally {
      setBusy(null);
    }
  };

  const handleVote = async (id: number) => {
    if (!user) {
      window.location.href = loginUrl("aad");
      return;
    }
    try {
      setBusy(id);
      await voteDate(id);
      await load();
    } catch (e: any) {
      setErr(e.message || "Couldn't record your vote.");
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm("Remove this proposed date?")) return;
    try {
      setBusy(id);
      await removeDate(id);
      await load();
    } catch (e: any) {
      setErr(e.message || "Couldn't remove that date.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="section felt" id="plan">
      <div className="section-inner">
        <h2 className="section-title">Plan the Next Night</h2>
        <p className="section-sub">
          Propose dates, vote for the ones you can make, then lock in the tournament.
        </p>

        <div className="plan-share">
          <a
            className="btn-whatsapp"
            href={whatsappShareUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span aria-hidden="true">💬</span> Share on WhatsApp
          </a>
        </div>

        {source === "seed" && (
          <p className="admin-banner">
            ⚠️ The planner needs the live database. Voting is disabled in seed mode.
          </p>
        )}

        {authChecked && !user && (
          <p className="admin-banner">
            🔑 <a className="inline-link" href={loginUrl("aad")}>Sign in</a> to propose dates and vote.
          </p>
        )}

        {err && <p className="admin-note err" style={{ textAlign: "center" }}>{err}</p>}

        {leader && (
          <div className="plan-leader">
            <span className="plan-leader-tag">Front-runner</span>
            <span className="plan-leader-date">{prettyDate(leader.date)}</span>
            <span className="plan-leader-votes">
              {leader.voteCount} {leader.voteCount === 1 ? "vote" : "votes"}
            </span>
          </div>
        )}

        <div className="plan-grid">
          <div className="plan-calendar">
            <div className="cal-head">
              <button type="button" className="btn-ghost" onClick={() => move(-1)} aria-label="Previous month">
                ‹
              </button>
              <span className="cal-month">{monthLabel}</span>
              <button type="button" className="btn-ghost" onClick={() => move(1)} aria-label="Next month">
                ›
              </button>
            </div>
            <div className="cal-weekdays">
              {WEEKDAYS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="cal-days">
              {cells.map((d, i) => {
                if (!d) return <span key={i} className="cal-cell empty" />;
                const key = iso(d);
                const cand = byIso.get(key);
                const past = key < todayIso;
                const cls = [
                  "cal-cell",
                  past ? "past" : "",
                  cand ? "candidate" : "",
                  cand?.votedByMe ? "voted" : "",
                  key === todayIso ? "today" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <button
                    key={i}
                    type="button"
                    className={cls}
                    disabled={past || (!cand && !canWrite)}
                    onClick={() => handleDayClick(d)}
                    title={cand ? `${cand.voteCount} vote(s)` : canWrite ? "Propose this date" : ""}
                  >
                    <span className="cal-num">{d.getDate()}</span>
                    {cand && <span className="cal-votes">{cand.voteCount}</span>}
                  </button>
                );
              })}
            </div>
            <p className="cal-hint">
              {canWrite
                ? "Click a free day to propose it. Click a highlighted day to vote."
                : "Highlighted days are proposed. Sign in to vote."}
            </p>
          </div>

          <div className="plan-list">
            {loading ? (
              <p className="stats-note">Loading proposed dates…</p>
            ) : sorted.length === 0 ? (
              <p className="stats-note">No dates proposed yet. Pick one from the calendar.</p>
            ) : (
              sorted.map((d) => (
                <PlanDateCard
                  key={d.id}
                  d={d}
                  members={members}
                  isLeader={leader?.id === d.id}
                  canWrite={canWrite}
                  busy={busy === d.id}
                  onVote={() => handleVote(d.id)}
                  onRemove={() => handleRemove(d.id)}
                  onSetup={async (name, venue) => {
                    try {
                      setBusy(d.id);
                      await setupFromDate(d.id, { name, venue });
                      await load();
                      await refresh();
                      // Tournament created — jump to Tournaments to fill in details.
                      navigate("/tournaments");
                    } catch (e: any) {
                      setErr(e.message || "Couldn't set up the tournament.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

interface CardProps {
  d: PlanningDate;
  members: Member[];
  isLeader: boolean;
  canWrite: boolean;
  busy: boolean;
  onVote: () => void;
  onRemove: () => void;
  onSetup: (name: string, venue: string) => void;
}

function PlanDateCard({ d, members, isLeader, canWrite, busy, onVote, onRemove, onSetup }: CardProps) {
  const [setup, setSetup] = useState(false);
  const [name, setName] = useState(() => randomTournamentName(d.date));
  const [venue, setVenue] = useState("The Card Room, Ealing");

  const handleMemberSelect = (memberId: string) => {
    if (!memberId) return;
    const member = members.find((m) => m.id === memberId);
    if (member) setVenue(member.location || member.name);
  };

  return (
    <div className={`plan-card ${isLeader ? "leader" : ""}`}>
      <div className="plan-card-head">
        <div>
          <div className="plan-card-date">{prettyDate(d.date)}</div>
          {isLeader && <span className="plan-badge">Most popular</span>}
        </div>
        <button
          type="button"
          className={`vote-btn ${d.votedByMe ? "on" : ""}`}
          onClick={onVote}
          disabled={busy}
        >
          {d.votedByMe ? "✓ Available" : "Vote"}
          <span className="vote-count">{d.voteCount}</span>
        </button>
      </div>

      {d.voters.length > 0 && (
        <div className="plan-voters">
          {d.voters.map((v) => (
            <span className="voter-chip" key={v.email}>
              {v.name || v.email.split("@")[0]}
            </span>
          ))}
        </div>
      )}

      {canWrite && (
        <div className="plan-card-actions">
          {!setup ? (
            <>
              <button type="button" className="btn-save" onClick={() => setSetup(true)}>
                Set up tournament
              </button>
              <button type="button" className="btn-danger" onClick={onRemove} disabled={busy}>
                Remove
              </button>
            </>
          ) : (
            <div className="plan-setup">
              <label>
                Tournament name
                <div className="plan-name-row">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. August Freezeout"
                  />
                  <button
                    type="button"
                    className="btn-ghost"
                    title="Suggest another name"
                    onClick={() => setName(randomTournamentName(d.date))}
                  >
                    🎲
                  </button>
                </div>
              </label>
              <label>
                Venue
                <input value={venue} onChange={(e) => setVenue(e.target.value)} />
              </label>
              <label>
                Or use a member's address
                <select
                  defaultValue=""
                  onChange={(e) => {
                    handleMemberSelect(e.target.value);
                    e.target.value = "";
                  }}
                >
                  <option value="">Select a member…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.location ? ` — ${m.location}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="plan-setup-note">
                {d.voters.length} player{d.voters.length === 1 ? "" : "s"} agreed they can make it.
              </p>
              <div className="plan-card-actions">
                <button
                  type="button"
                  className="btn-save"
                  disabled={busy || !name.trim()}
                  onClick={() => onSetup(name.trim(), venue.trim())}
                >
                  Create tournament
                </button>
                <button type="button" className="btn-ghost" onClick={() => setSetup(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
