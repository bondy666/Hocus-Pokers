import { useState, useEffect, type FormEvent } from "react";
import { useClub } from "../ClubContext.ts";
import {
  recordResult,
  awardTrophy,
  createTournament,
  createMember,
  updateMember,
  deleteMember,
  updateTournament,
  deleteTournament,
  getResults,
  updateResult,
  deleteResult,
  updateTrophy,
  deleteTrophy,
  loginUrl,
  logoutUrl,
  type NewResult,
  type NewTrophy,
  type NewTournament,
  type NewMember,
  type ResultRow,
} from "../api.ts";
import type { Member, Tournament } from "../data.ts";

type Note = { kind: "ok" | "err"; text: string } | null;

function useFormNote() {
  const [note, setNote] = useState<Note>(null);
  const ok = (text: string) => setNote({ kind: "ok", text });
  const err = (text: string) => setNote({ kind: "err", text });
  return { note, ok, err, clear: () => setNote(null) };
}

function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return <p className={`admin-note ${note.kind}`}>{note.text}</p>;
}

export default function Admin() {
  const { members, tournaments, source, refresh, user, authChecked } = useClub();

  const seedMode = source === "seed";

  return (
    <section className="section felt" id="admin">
      <div className="section-inner">
        <h2 className="section-title">Score Keeper</h2>
        <p className="section-sub">Add, edit and remove members, tournaments, results and trophies.</p>

        {seedMode && (
          <p className="admin-banner">
            ⚠️ API is in <strong>seed mode</strong>. Saving needs a database — set
            <code> SQL_CONNECTION_STRING</code> on the server to enable writes.
          </p>
        )}

        <div className="admin-auth">
          {!authChecked ? (
            <p className="admin-auth-hint">Checking sign-in…</p>
          ) : user ? (
            <div className="admin-user">
              <span className="admin-user-info">
                Signed in as <strong>{user.name || user.email}</strong>
                <span className="admin-provider">via {providerLabel(user.provider)}</span>
              </span>
              <a className="admin-signout" href={logoutUrl()}>
                Sign out
              </a>
            </div>
          ) : (
            <div className="admin-login">
              <p className="admin-auth-hint">Sign in to manage the club records.</p>
              <div className="admin-login-buttons">
                <a className="login-btn google" href={loginUrl("google")}>
                  <span className="login-icon">G</span> Sign in with Google
                </a>
                <a className="login-btn microsoft" href={loginUrl("aad")}>
                  <span className="login-icon">⊞</span> Sign in with Microsoft
                </a>
              </div>
            </div>
          )}
        </div>

        {user && user.canWrite === false && (
          <p className="admin-banner">
            🔒 You're signed in as <strong>{user.email}</strong>, but this account isn't on the
            organiser allow-list, so saving is disabled.
          </p>
        )}

        {user && user.canWrite !== false && (
          <div className="admin-stack">
            <AddForms members={members} tournaments={tournaments} refresh={refresh} />
            <ManageMembers members={members} refresh={refresh} />
            <ManageTournaments members={members} tournaments={tournaments} refresh={refresh} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- Add forms ---------------- */

function AddForms({
  members,
  tournaments,
  refresh,
}: {
  members: Member[];
  tournaments: Tournament[];
  refresh: () => Promise<void>;
}) {
  const memberForm = useFormNote();
  const resultForm = useFormNote();
  const trophyForm = useFormNote();
  const tournamentForm = useFormNote();

  const [member, setMember] = useState<NewMember>({
    name: "",
    nickname: "",
    location: "Ealing",
    email: "",
    joined: new Date().getFullYear(),
  });

  const [result, setResult] = useState<NewResult & { tournamentId: string }>({
    tournamentId: tournaments[0]?.id ?? "",
    userId: Number(members[0]?.id) || 0,
    finishPlace: undefined,
    buyInTotal: 40,
    cashOut: 0,
  });

  const [trophy, setTrophy] = useState<NewTrophy & { memberId: string }>({
    memberId: members[0]?.id ?? "",
    label: "",
    emoji: "🏆",
  });

  const [tournament, setTournament] = useState<NewTournament>({
    name: "",
    date: new Date().toISOString().slice(0, 10),
    venue: "The Card Room, Ealing",
    address: "",
    players: 16,
    buyIn: 10,
    prizePool: 800,
    status: "upcoming",
  });

  async function submitMember(e: FormEvent) {
    e.preventDefault();
    try {
      await createMember({ ...member, joined: Number(member.joined) || undefined });
      memberForm.ok(`Added “${member.name}”`);
      setMember({ name: "", nickname: "", location: "Ealing", email: "", joined: new Date().getFullYear() });
      await refresh();
    } catch (err) {
      memberForm.err((err as Error).message);
    }
  }

  async function submitResult(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await recordResult(result.tournamentId, {
        userId: Number(result.userId),
        finishPlace: result.finishPlace ? Number(result.finishPlace) : undefined,
        buyInTotal: Number(result.buyInTotal),
        cashOut: Number(result.cashOut),
      });
      resultForm.ok(`Result recorded · net ${r.net >= 0 ? "+" : ""}£${r.net}`);
      await refresh();
    } catch (err) {
      resultForm.err((err as Error).message);
    }
  }

  async function submitTrophy(e: FormEvent) {
    e.preventDefault();
    try {
      await awardTrophy(trophy.memberId, {
        label: trophy.label,
        emoji: trophy.emoji,
        awardedOn: trophy.awardedOn,
        note: trophy.note,
      });
      trophyForm.ok(`Awarded “${trophy.label}”`);
      setTrophy({ ...trophy, label: "" });
      await refresh();
    } catch (err) {
      trophyForm.err((err as Error).message);
    }
  }

  async function submitTournament(e: FormEvent) {
    e.preventDefault();
    try {
      await createTournament({
        ...tournament,
        players: Number(tournament.players),
        buyIn: Number(tournament.buyIn),
        prizePool: Number(tournament.prizePool),
      });
      tournamentForm.ok(`Created “${tournament.name}”`);
      setTournament({ ...tournament, name: "" });
      await refresh();
    } catch (err) {
      tournamentForm.err((err as Error).message);
    }
  }

  return (
    <div>
      <h3 className="admin-group-title">Add records</h3>
      <div className="admin-grid">
        {/* Add member */}
        <form className="admin-card" onSubmit={submitMember}>
          <h3 className="admin-card-title">Add a member</h3>
          <label>
            Name
            <input
              type="text"
              placeholder="Jane Doe"
              value={member.name}
              onChange={(e) => setMember({ ...member, name: e.target.value })}
              required
            />
          </label>
          <div className="admin-row">
            <label>
              Nickname
              <input
                type="text"
                placeholder="The Shark"
                value={member.nickname ?? ""}
                onChange={(e) => setMember({ ...member, nickname: e.target.value })}
              />
            </label>
            <label>
              Joined
              <input
                type="number"
                min={2000}
                max={2100}
                value={member.joined ?? ""}
                onChange={(e) => setMember({ ...member, joined: Number(e.target.value) })}
              />
            </label>
          </div>
          <label>
            Location
            <input
              type="text"
              value={member.location ?? ""}
              onChange={(e) => setMember({ ...member, location: e.target.value })}
            />
          </label>
          <label>
            Login email
            <input
              type="email"
              placeholder="name@example.com"
              value={member.email ?? ""}
              onChange={(e) => setMember({ ...member, email: e.target.value })}
            />
          </label>
          <button type="submit">Add member</button>
          <NoteLine note={memberForm.note} />
        </form>

        {/* Add tournament */}
        <form className="admin-card" onSubmit={submitTournament}>
          <h3 className="admin-card-title">Add a tournament</h3>
          <label>
            Name
            <input
              type="text"
              placeholder="Autumn Freezeout"
              value={tournament.name}
              onChange={(e) => setTournament({ ...tournament, name: e.target.value })}
              required
            />
          </label>
          <div className="admin-row">
            <label>
              Date
              <input
                type="date"
                value={tournament.date}
                onChange={(e) => setTournament({ ...tournament, date: e.target.value })}
                required
              />
            </label>
            <label>
              Status
              <select
                value={tournament.status}
                onChange={(e) =>
                  setTournament({ ...tournament, status: e.target.value as NewTournament["status"] })
                }
              >
                <option value="upcoming">Upcoming</option>
                <option value="live">Live</option>
                <option value="complete">Complete</option>
              </select>
            </label>
          </div>
          <label>
            Venue
            <input
              type="text"
              value={tournament.venue}
              onChange={(e) => setTournament({ ...tournament, venue: e.target.value })}
              required
            />
          </label>
          <label>
            Address
            <input
              type="text"
              value={tournament.address ?? ""}
              onChange={(e) => setTournament({ ...tournament, address: e.target.value })}
              placeholder="Full street address of the venue"
            />
          </label>
          <div className="admin-row">
            <label>
              Players
              <input
                type="number"
                min={0}
                value={tournament.players}
                onChange={(e) => setTournament({ ...tournament, players: Number(e.target.value) })}
              />
            </label>
            <label>
              Buy-in (£)
              <input
                type="number"
                min={0}
                value={tournament.buyIn}
                onChange={(e) => setTournament({ ...tournament, buyIn: Number(e.target.value) })}
              />
            </label>
            <label>
              Prize pool (£)
              <input
                type="number"
                min={0}
                value={tournament.prizePool}
                onChange={(e) => setTournament({ ...tournament, prizePool: Number(e.target.value) })}
              />
            </label>
          </div>
          <label>
            Host
            <select
              value={tournament.hostId ?? ""}
              onChange={(e) => setTournament({ ...tournament, hostId: e.target.value || undefined })}
            >
              <option value="">— none —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Create tournament</button>
          <NoteLine note={tournamentForm.note} />
        </form>

        {/* Record result */}
        <form className="admin-card" onSubmit={submitResult}>
          <h3 className="admin-card-title">Record a result</h3>
          <label>
            Tournament
            <select
              value={result.tournamentId}
              onChange={(e) => setResult({ ...result, tournamentId: e.target.value })}
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Player
            <select
              value={result.userId}
              onChange={(e) => setResult({ ...result, userId: Number(e.target.value) })}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-row">
            <label>
              Finish place
              <input
                type="number"
                min={1}
                value={result.finishPlace ?? ""}
                onChange={(e) =>
                  setResult({ ...result, finishPlace: e.target.value ? Number(e.target.value) : undefined })
                }
              />
            </label>
            <label>
              Buy-in (£)
              <input
                type="number"
                min={0}
                value={result.buyInTotal}
                onChange={(e) => setResult({ ...result, buyInTotal: Number(e.target.value) })}
              />
            </label>
            <label>
              Cash-out (£)
              <input
                type="number"
                min={0}
                value={result.cashOut}
                onChange={(e) => setResult({ ...result, cashOut: Number(e.target.value) })}
              />
            </label>
          </div>
          <button type="submit">Save result</button>
          <NoteLine note={resultForm.note} />
        </form>

        {/* Award trophy */}
        <form className="admin-card" onSubmit={submitTrophy}>
          <h3 className="admin-card-title">Award a trophy</h3>
          <label>
            Player
            <select
              value={trophy.memberId}
              onChange={(e) => setTrophy({ ...trophy, memberId: e.target.value })}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-row">
            <label className="grow">
              Label
              <input
                type="text"
                placeholder="Bluff of the Year"
                value={trophy.label}
                onChange={(e) => setTrophy({ ...trophy, label: e.target.value })}
                required
              />
            </label>
            <label className="narrow">
              Emoji
              <input
                type="text"
                value={trophy.emoji}
                onChange={(e) => setTrophy({ ...trophy, emoji: e.target.value })}
              />
            </label>
          </div>
          <button type="submit">Award trophy</button>
          <NoteLine note={trophyForm.note} />
        </form>
      </div>
    </div>
  );
}

/* ---------------- Manage members ---------------- */

function ManageMembers({ members, refresh }: { members: Member[]; refresh: () => Promise<void> }) {
  return (
    <div>
      <h3 className="admin-group-title">Manage members</h3>
      <div className="manage-list">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} refresh={refresh} />
        ))}
        {members.length === 0 && <p className="admin-auth-hint">No members yet.</p>}
      </div>
    </div>
  );
}

function MemberRow({ member, refresh }: { member: Member; refresh: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<NewMember>({
    name: member.name,
    nickname: member.nickname,
    location: member.location,
    email: member.email ?? "",
    joined: member.joined,
  });
  const { note, err, clear } = useFormNote();
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    clear();
    try {
      await updateMember(member.id, { ...form, joined: Number(form.joined) || undefined });
      setEditing(false);
      await refresh();
    } catch (e) {
      err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${member.name}? This cannot be undone.`)) return;
    setBusy(true);
    clear();
    try {
      await deleteMember(member.id);
      await refresh();
    } catch (e) {
      err((e as Error).message);
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="manage-item">
        <div className="admin-row">
          <label>
            Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Nickname
            <input
              value={form.nickname ?? ""}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
            />
          </label>
        </div>
        <div className="admin-row">
          <label>
            Location
            <input
              value={form.location ?? ""}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </label>
          <label>
            Joined
            <input
              type="number"
              value={form.joined ?? ""}
              onChange={(e) => setForm({ ...form, joined: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          Login email
          <input
            type="email"
            placeholder="name@example.com"
            value={form.email ?? ""}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <div className="manage-actions">
          <button className="btn-save" onClick={save} disabled={busy}>
            Save
          </button>
          <button className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        </div>
        <NoteLine note={note} />
      </div>
    );
  }

  return (
    <div className="manage-item">
      <div className="manage-head">
        <div className="manage-title">
          {member.name}
          {member.nickname && <span className="manage-sub"> “{member.nickname}”</span>}
        </div>
        <div className="manage-meta">
          {member.location || "—"} · joined {member.joined} · {member.games} games · net{" "}
          {member.netPnl >= 0 ? "+" : ""}£{member.netPnl}
          {member.email && <> · ✉ {member.email}</>}
        </div>
        <div className="manage-actions">
          <button className="btn-ghost" onClick={() => setEditing(true)} disabled={busy}>
            Edit
          </button>
          <button className="btn-danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        </div>
      </div>

      {member.trophies.length > 0 && (
        <div className="manage-trophies">
          {member.trophies.map((t) => (
            <TrophyChip key={t.id} id={t.id} label={t.label} emoji={t.emoji} note={t.note} refresh={refresh} />
          ))}
        </div>
      )}
      <NoteLine note={note} />
    </div>
  );
}

function TrophyChip({
  id,
  label,
  emoji,
  note,
  refresh,
}: {
  id: string;
  label: string;
  emoji: string;
  note?: string;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<NewTrophy>({ label, emoji, note });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateTrophy(id, form);
      setEditing(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove trophy “${label}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTrophy(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className="trophy-chip editing">
        <input
          className="chip-emoji"
          value={form.emoji}
          onChange={(e) => setForm({ ...form, emoji: e.target.value })}
        />
        <input
          className="chip-label"
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
        <button className="chip-btn" onClick={save} disabled={busy}>
          ✓
        </button>
        <button className="chip-btn" onClick={() => setEditing(false)} disabled={busy}>
          ✕
        </button>
        {error && <span className="chip-err">{error}</span>}
      </span>
    );
  }

  return (
    <span className="trophy-chip">
      <span className="chip-emoji-static">{emoji}</span> {label}
      <button className="chip-btn" title="Edit" onClick={() => setEditing(true)} disabled={busy}>
        ✎
      </button>
      <button className="chip-btn" title="Remove" onClick={remove} disabled={busy}>
        🗑
      </button>
    </span>
  );
}

/* ---------------- Manage tournaments ---------------- */

function ManageTournaments({
  members,
  tournaments,
  refresh,
}: {
  members: Member[];
  tournaments: Tournament[];
  refresh: () => Promise<void>;
}) {
  return (
    <div>
      <h3 className="admin-group-title">Manage tournaments</h3>
      <div className="manage-list">
        {tournaments.map((t) => (
          <TournamentRow key={t.id} tournament={t} members={members} refresh={refresh} />
        ))}
        {tournaments.length === 0 && <p className="admin-auth-hint">No tournaments yet.</p>}
      </div>
    </div>
  );
}

function TournamentRow({
  tournament,
  members,
  refresh,
}: {
  tournament: Tournament;
  members: Member[];
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [form, setForm] = useState<NewTournament>({
    name: tournament.name,
    date: tournament.date,
    venue: tournament.venue,
    address: tournament.address ?? "",
    players: tournament.players,
    buyIn: 0,
    prizePool: tournament.prizePool,
    status: tournament.status,
    winnerId: tournament.winnerId,
    hostId: tournament.hostId,
  });
  const { note, err, clear } = useFormNote();
  const [busy, setBusy] = useState(false);

  const memberName = (id?: string) => members.find((m) => m.id === id)?.name;

  async function save() {
    setBusy(true);
    clear();
    try {
      await updateTournament(tournament.id, {
        ...form,
        players: Number(form.players),
        buyIn: Number(form.buyIn),
        prizePool: Number(form.prizePool),
      });
      setEditing(false);
      await refresh();
    } catch (e) {
      err((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete “${tournament.name}” and all its results?`)) return;
    setBusy(true);
    clear();
    try {
      await deleteTournament(tournament.id);
      await refresh();
    } catch (e) {
      err((e as Error).message);
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="manage-item">
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <div className="admin-row">
          <label>
            Date
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as NewTournament["status"] })}
            >
              <option value="upcoming">Upcoming</option>
              <option value="live">Live</option>
              <option value="complete">Complete</option>
            </select>
          </label>
        </div>
        <label>
          Venue
          <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        </label>
        <label>
          Address
          <input
            value={form.address ?? ""}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Full street address of the venue"
          />
        </label>
        <div className="admin-row">
          <label>
            Players
            <input
              type="number"
              value={form.players}
              onChange={(e) => setForm({ ...form, players: Number(e.target.value) })}
            />
          </label>
          <label>
            Prize pool (£)
            <input
              type="number"
              value={form.prizePool}
              onChange={(e) => setForm({ ...form, prizePool: Number(e.target.value) })}
            />
          </label>
          <label>
            Winner
            <select
              value={form.winnerId ?? ""}
              onChange={(e) => setForm({ ...form, winnerId: e.target.value || undefined })}
            >
              <option value="">— none —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Host
            <select
              value={form.hostId ?? ""}
              onChange={(e) => setForm({ ...form, hostId: e.target.value || undefined })}
            >
              <option value="">— none —</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="manage-actions">
          <button className="btn-save" onClick={save} disabled={busy}>
            Save
          </button>
          <button className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        </div>
        <NoteLine note={note} />
      </div>
    );
  }

  return (
    <div className="manage-item">
      <div className="manage-head">
        <div className="manage-title">
          {tournament.name} <span className={`status-pill ${tournament.status}`}>{tournament.status}</span>
        </div>
        <div className="manage-meta">
          {tournament.date} · {tournament.venue} · {tournament.players} players · £{tournament.prizePool}
          {tournament.winnerId && <> · 🏆 {memberName(tournament.winnerId) ?? "—"}</>}
          {tournament.hostId && <> · 🏠 {memberName(tournament.hostId) ?? "—"}</>}
        </div>
        <div className="manage-actions">
          <button className="btn-ghost" onClick={() => setShowResults((s) => !s)} disabled={busy}>
            {showResults ? "Hide results" : "Results"}
          </button>
          <button className="btn-ghost" onClick={() => setEditing(true)} disabled={busy}>
            Edit
          </button>
          <button className="btn-danger" onClick={remove} disabled={busy}>
            Delete
          </button>
        </div>
      </div>
      {showResults && <ResultsPanel tournamentId={tournament.id} refresh={refresh} />}
      <NoteLine note={note} />
    </div>
  );
}

function ResultsPanel({ tournamentId, refresh }: { tournamentId: string; refresh: () => Promise<void> }) {
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    getResults(tournamentId)
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [tournamentId]);

  async function reload() {
    setError(null);
    try {
      setRows(await getResults(tournamentId));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function afterChange() {
    await reload();
    await refresh();
  }

  if (error) return <p className="admin-note err">{error}</p>;
  if (!rows) return <p className="admin-auth-hint">Loading results…</p>;
  if (rows.length === 0) return <p className="admin-auth-hint">No results recorded yet.</p>;

  return (
    <div className="results-table">
      <div className="results-head">
        <span>Player</span>
        <span>Place</span>
        <span>Buy-in</span>
        <span>Cash-out</span>
        <span>Net</span>
        <span></span>
      </div>
      {rows.map((r) => (
        <ResultRowItem key={r.id} row={r} afterChange={afterChange} />
      ))}
    </div>
  );
}

function ResultRowItem({ row, afterChange }: { row: ResultRow; afterChange: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ finishPlace?: number; buyInTotal: number; cashOut: number }>({
    finishPlace: row.finish_place ?? undefined,
    buyInTotal: Number(row.buy_in_total),
    cashOut: Number(row.cash_out),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateResult(row.id, {
        finishPlace: form.finishPlace ? Number(form.finishPlace) : undefined,
        buyInTotal: Number(form.buyInTotal),
        cashOut: Number(form.cashOut),
      });
      setEditing(false);
      await afterChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${row.user_name}'s result?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteResult(row.id);
      await afterChange();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="results-row editing">
        <span>{row.user_name}</span>
        <input
          type="number"
          value={form.finishPlace ?? ""}
          onChange={(e) =>
            setForm({ ...form, finishPlace: e.target.value ? Number(e.target.value) : undefined })
          }
        />
        <input
          type="number"
          value={form.buyInTotal}
          onChange={(e) => setForm({ ...form, buyInTotal: Number(e.target.value) })}
        />
        <input
          type="number"
          value={form.cashOut}
          onChange={(e) => setForm({ ...form, cashOut: Number(e.target.value) })}
        />
        <span>{Number(form.cashOut) - Number(form.buyInTotal)}</span>
        <span className="results-actions">
          <button className="chip-btn" onClick={save} disabled={busy}>
            ✓
          </button>
          <button className="chip-btn" onClick={() => setEditing(false)} disabled={busy}>
            ✕
          </button>
        </span>
        {error && <span className="chip-err">{error}</span>}
      </div>
    );
  }

  const net = Number(row.net);
  return (
    <div className="results-row">
      <span>{row.user_name}</span>
      <span>{row.finish_place ?? "—"}</span>
      <span>£{Number(row.buy_in_total)}</span>
      <span>£{Number(row.cash_out)}</span>
      <span className={net >= 0 ? "pos" : "neg"}>
        {net >= 0 ? "+" : ""}£{net}
      </span>
      <span className="results-actions">
        <button className="chip-btn" title="Edit" onClick={() => setEditing(true)} disabled={busy}>
          ✎
        </button>
        <button className="chip-btn" title="Delete" onClick={remove} disabled={busy}>
          🗑
        </button>
      </span>
      {error && <span className="chip-err">{error}</span>}
    </div>
  );
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "google":
      return "Google";
    case "aad":
    case "azureactivedirectory":
    case "microsoftaccount":
      return "Microsoft";
    case "dev":
      return "dev mode";
    default:
      return provider;
  }
}
