import { useState, useEffect, type FormEvent } from "react";
import { useClub } from "../ClubContext.ts";
import {
  awardTrophy,
  updateTournament,
  deleteTournament,
  getResults,
  updateResult,
  deleteResult,
  loginUrl,
  logoutUrl,
  type NewTrophy,
  type NewTournament,
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
        <h2 className="section-title">Trophy Room</h2>
        <p className="section-sub">Add, edit and remove members, results and trophies.</p>

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

        {user && (
          <div className="admin-stack">
            <AddForms members={members} refresh={refresh} />
            <ManageTournaments members={members} tournaments={tournaments} refresh={refresh} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ---------------- Add forms ---------------- */

// Emoji choices for a trophy/award.
const TROPHY_EMOJIS = [
  "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "👑", "💎",
  "♠️", "♥️", "♣️", "♦️", "🃏", "🎲", "💰", "💵",
  "🔥", "⭐", "🌟", "💪", "🤡", "🐟", "🦈", "🧊",
];

function AddForms({
  members,
  refresh,
}: {
  members: Member[];
  refresh: () => Promise<void>;
}) {
  const trophyForm = useFormNote();

  const [trophy, setTrophy] = useState<NewTrophy & { memberId: string }>({
    memberId: "",
    label: "",
    emoji: "🏆",
  });

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

  return (
    <div>
      <h3 className="admin-group-title">Add records</h3>
      <div className="admin-grid">
        {/* Award trophy */}
        <form className="admin-card" onSubmit={submitTrophy}>
          <h3 className="admin-card-title">Award a trophy</h3>
          <label>
            Player
            <select
              value={trophy.memberId}
              onChange={(e) => setTrophy({ ...trophy, memberId: e.target.value })}
              required
            >
              <option value="">— select a player —</option>
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
          </div>
          <span className="field-label">Trophy</span>
          <div className="emoji-picker" role="radiogroup" aria-label="Trophy emoji">
            {TROPHY_EMOJIS.map((em) => (
              <button
                type="button"
                key={em}
                className={`emoji-option${trophy.emoji === em ? " selected" : ""}`}
                aria-pressed={trophy.emoji === em}
                title={em}
                onClick={() => setTrophy({ ...trophy, emoji: em })}
              >
                {em}
              </button>
            ))}
          </div>
          <button type="submit">Award trophy</button>
          <NoteLine note={trophyForm.note} />
        </form>
      </div>
    </div>
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
        players: Number(form.players) || 0,
        buyIn: Number(form.buyIn),
        prizePool: Number(form.prizePool) || 0,
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
        <label>
          Address
          <input
            value={form.address ?? ""}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Full street address of the venue"
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
        <div className="admin-row">
          <label>
            Players
            <input
              type="number"
              value={Number.isNaN(form.players) ? "" : form.players}
              onChange={(e) =>
                setForm({ ...form, players: e.target.value === "" ? NaN : Number(e.target.value) })
              }
            />
          </label>
          <label>
            Prize pool (£)
            <input
              type="number"
              value={Number.isNaN(form.prizePool) ? "" : form.prizePool}
              onChange={(e) =>
                setForm({ ...form, prizePool: e.target.value === "" ? NaN : Number(e.target.value) })
              }
            />
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
        buyInTotal: Number(form.buyInTotal) || 0,
        cashOut: Number(form.cashOut) || 0,
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
          value={Number.isNaN(form.buyInTotal) ? "" : form.buyInTotal}
          onChange={(e) =>
            setForm({ ...form, buyInTotal: e.target.value === "" ? NaN : Number(e.target.value) })
          }
        />
        <input
          type="number"
          value={Number.isNaN(form.cashOut) ? "" : form.cashOut}
          onChange={(e) =>
            setForm({ ...form, cashOut: e.target.value === "" ? NaN : Number(e.target.value) })
          }
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
