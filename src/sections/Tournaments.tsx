import { useState } from "react";
import { gbp, winnerName, type Tournament, type TournamentStatus, type Member } from "../data.ts";
import { useClub } from "../ClubContext.ts";
import { updateTournament, deleteTournament, type NewTournament } from "../api.ts";
import TournamentPhotos from "../components/TournamentPhotos.tsx";

const order: Record<TournamentStatus, number> = { live: 0, upcoming: 1, complete: 2 };

const statusLabel: Record<TournamentStatus, string> = {
  live: "Live now",
  upcoming: "Upcoming",
  complete: "Complete",
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function Tournaments() {
  const { members, tournaments, user, refresh } = useClub();
  const canWrite = !!user && user.canWrite !== false;
  const [editingId, setEditingId] = useState<string | null>(null);

  const sorted = [...tournaments].sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.date < b.date ? 1 : -1;
  });

  return (
    <section className="section felt" id="tournaments">
      <div className="section-inner">
        <h2 className="section-title">Tournaments</h2>
        <p className="section-sub">Live, upcoming and settled — the full felt calendar.</p>

        <ul className="tournament-list">
          {sorted.map((t) =>
            editingId === t.id ? (
              <li className="tournament editing" key={t.id}>
                <EditTournament
                  tournament={t}
                  members={members}
                  onDone={async () => {
                    setEditingId(null);
                    await refresh();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li className="tournament" key={t.id}>
                <div className="tournament-main">
                  <div className="tournament-top">
                    <span className={`status status-${t.status}`}>
                      {t.status === "live" && <span className="live-dot" />}
                      {statusLabel[t.status]}
                    </span>
                    <span className="tournament-date">{formatDate(t.date)}</span>
                  </div>
                  <h3 className="tournament-name">{t.name}</h3>
                  <p className="tournament-venue">{t.venue}</p>
                  {t.address && <p className="tournament-address">📍 {t.address}</p>}
                  {canWrite && (
                    <div className="tournament-admin">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setEditingId(t.id)}
                      >
                        Edit
                      </button>
                      <DeleteButton id={t.id} name={t.name} refresh={refresh} />
                    </div>
                  )}
                </div>

                <div className="tournament-meta">
                  <div>
                    <span className="tm-value">{t.players}</span>
                    <span className="tm-label">Players</span>
                  </div>
                  <div>
                    <span className="tm-value">{gbp(t.prizePool)}</span>
                    <span className="tm-label">Prize pool</span>
                  </div>
                  <div>
                    <span className="tm-value">
                      {t.status === "complete" ? winnerName(members, t.winnerId) : "—"}
                    </span>
                    <span className="tm-label">Winner</span>
                  </div>
                </div>

                <TournamentPhotos tournamentId={t.id} />
              </li>
            )
          )}
        </ul>
      </div>
    </section>
  );
}

function DeleteButton({
  id,
  name,
  refresh,
}: {
  id: string;
  name: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (!confirm(`Delete "${name}"? This also removes its recorded results.`)) return;
    try {
      setBusy(true);
      setError(null);
      await deleteTournament(id);
      await refresh();
    } catch (e: any) {
      setError(e.message || "Failed to delete");
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-danger" onClick={onClick} disabled={busy}>
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && <span className="chip-err">{error}</span>}
    </>
  );
}

function EditTournament({
  tournament,
  members,
  onDone,
  onCancel,
}: {
  tournament: Tournament;
  members: Member[];
  onDone: () => void | Promise<void>;
  onCancel: () => void;
}) {
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
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<NewTournament>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.name.trim() || !form.date) {
      setError("Name and date are required.");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await updateTournament(tournament.id, form);
      await onDone();
    } catch (e: any) {
      setError(e.message || "Failed to save");
      setBusy(false);
    }
  };

  return (
    <div className="tournament-edit">
      <div className="admin-row">
        <label className="grow">
          Name
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="narrow">
          Date
          <input
            type="date"
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
          />
        </label>
      </div>
      <div className="admin-row">
        <label className="grow">
          Venue
          <input value={form.venue} onChange={(e) => set({ venue: e.target.value })} />
        </label>
        <label className="narrow">
          Players
          <input
            type="number"
            value={form.players}
            onChange={(e) => set({ players: Number(e.target.value) })}
          />
        </label>
        <label className="narrow">
          Prize £
          <input
            type="number"
            value={form.prizePool}
            onChange={(e) => set({ prizePool: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="admin-row">
        <label className="grow">
          Address
          <input
            value={form.address ?? ""}
            onChange={(e) => set({ address: e.target.value })}
            placeholder="Full street address of the venue"
          />
        </label>
      </div>
      <div className="admin-row">
        <label>
          Status
          <select
            value={form.status}
            onChange={(e) => set({ status: e.target.value as TournamentStatus })}
          >
            <option value="upcoming">Upcoming</option>
            <option value="live">Live</option>
            <option value="complete">Complete</option>
          </select>
        </label>
        <label className="grow">
          Winner
          <select
            value={form.winnerId ?? ""}
            onChange={(e) => set({ winnerId: e.target.value || undefined })}
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
      {error && <p className="admin-note err">{error}</p>}
      <div className="manage-actions">
        <button type="button" className="btn-save" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
