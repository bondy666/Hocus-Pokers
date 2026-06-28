import { useMemo, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { gbp, winnerName, type Tournament, type TournamentStatus, type Member } from "../data.ts";
import { useClub } from "../ClubContext.ts";
import {
  updateTournament,
  deleteTournament,
  cloneTournament,
  confirmPlayer,
  unconfirmPlayer,
  recordResult,
  updateResult,
  getResults,
  type NewTournament,
  type ResultRow,
} from "../api.ts";
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

type VenueBook = {
  /** Distinct venue names previously used, most recent first. */
  options: string[];
  /** Lookup of the most recently used address for a given venue (lower-cased key). */
  addressByVenue: Map<string, string>;
};

// Builds a list of previously-used venues and the address last associated with each
// so the editor can suggest venue names and auto-fill the matching address.
function buildVenueBook(tournaments: Tournament[]): VenueBook {
  const names = new Map<string, string>();
  const addressByVenue = new Map<string, string>();
  const recentFirst = [...tournaments].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const t of recentFirst) {
    const venue = (t.venue ?? "").trim();
    if (!venue) continue;
    const key = venue.toLowerCase();
    if (!names.has(key)) names.set(key, venue);
    const address = (t.address ?? "").trim();
    if (address && !addressByVenue.has(key)) addressByVenue.set(key, address);
  }
  return { options: [...names.values()], addressByVenue };
}

// Playing-card "bullets" used next to confirmed-player badges. The card is
// picked deterministically from the tournament + player id so it stays stable
// across re-renders (no flicker) while still looking randomly dealt.
const CARD_SUITS = [
  { char: "♠", tone: "spade" },
  { char: "♥", tone: "heart" },
  { char: "♦", tone: "diamond" },
  { char: "♣", tone: "club" },
] as const;

const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function cardFor(seed: string): { rank: string; suit: (typeof CARD_SUITS)[number] } {
  const h = hashSeed(seed);
  const suit = CARD_SUITS[h % CARD_SUITS.length];
  const rank = CARD_RANKS[Math.floor(h / CARD_SUITS.length) % CARD_RANKS.length];
  return { rank, suit };
}

const placeMedal = (place: number | null | undefined): string =>
  place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : "";

// The per-bullet buy-in for a game, falling back to the club standard when a
// tournament has no buy-in recorded against it.
const bulletCost = (t: Tournament): number =>
  t.buyIn && t.buyIn > 0 ? t.buyIn : 10;

// Inline editor for a single player's game result: bullets (rebuys), finish
// place and winnings. Writes to the tournament_results record for the player.
function ResultEditor({
  tournament,
  member,
  existing,
  onSaved,
  onClose,
}: {
  tournament: Tournament;
  member: Member;
  existing?: ResultRow;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const perBullet = bulletCost(tournament);
  const initialBullets = existing
    ? Math.max(1, Math.round(existing.buy_in_total / perBullet))
    : 1;
  const [bullets, setBullets] = useState(initialBullets);
  const [place, setPlace] = useState<string>(
    existing?.finish_place != null ? String(existing.finish_place) : ""
  );
  const [winnings, setWinnings] = useState<number>(existing?.cash_out ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyInTotal = bullets * perBullet;
  const net = (Number(winnings) || 0) - buyInTotal;

  const save = async () => {
    try {
      setBusy(true);
      setError(null);
      const finishPlace = place === "" ? undefined : Number(place);
      const cashOut = Number(winnings) || 0;
      if (existing) {
        await updateResult(existing.id, { finishPlace, buyInTotal, cashOut });
      } else {
        await recordResult(tournament.id, {
          userId: Number(member.id),
          finishPlace,
          buyInTotal,
          cashOut,
        });
      }
      await onSaved();
    } catch (e: any) {
      setError(e.message || "Failed to save result");
      setBusy(false);
    }
  };

  return (
    <div className="result-editor">
      <div className="result-editor-head">
        <strong>{member.name}</strong>
        <button type="button" className="result-editor-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="result-editor-row">
        <span className="re-label">Bullets</span>
        <div className="re-stepper">
          <button type="button" onClick={() => setBullets((b) => Math.max(1, b - 1))} disabled={busy}>
            −
          </button>
          <span className="re-bullets">{bullets}</span>
          <button type="button" onClick={() => setBullets((b) => b + 1)} disabled={busy}>
            +
          </button>
        </div>
        <span className="re-buyin">= {gbp(buyInTotal)} <small>({gbp(perBullet)}/bullet)</small></span>
      </div>
      <div className="result-editor-row">
        <span className="re-label">Place</span>
        <div className="re-places">
          {[1, 2, 3].map((p) => (
            <button
              type="button"
              key={p}
              className={place === String(p) ? "re-place on" : "re-place"}
              onClick={() => setPlace((cur) => (cur === String(p) ? "" : String(p)))}
              disabled={busy}
            >
              {placeMedal(p)} {p}
              {p === 1 ? "st" : p === 2 ? "nd" : "rd"}
            </button>
          ))}
          <input
            type="number"
            min={1}
            className="re-place-input"
            placeholder="#"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            disabled={busy}
          />
        </div>
      </div>
      <div className="result-editor-row">
        <label className="re-label" htmlFor={`win-${tournament.id}-${member.id}`}>
          Won £
        </label>
        <input
          id={`win-${tournament.id}-${member.id}`}
          type="number"
          min={0}
          className="re-winnings"
          value={Number.isNaN(winnings) ? "" : winnings}
          onChange={(e) => setWinnings(e.target.value === "" ? NaN : Number(e.target.value))}
          disabled={busy}
        />
        <span className={`re-net ${net >= 0 ? "pos" : "neg"}`}>Net {gbp(net)}</span>
      </div>
      {error && <p className="admin-note err">{error}</p>}
      <div className="result-editor-actions">
        <button type="button" className="btn-save" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function GameRoster({
  tournament,
  members,
  canWrite,
  refresh,
}: {
  tournament: Tournament;
  members: Member[];
  canWrite: boolean;
  refresh: () => Promise<void>;
}) {
  const confirmedIds = tournament.confirmedPlayerIds ?? [];
  const confirmed = confirmedIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m));

  const [results, setResults] = useState<ResultRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addId, setAddId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadResults = useCallback(async () => {
    if (!canWrite) return;
    try {
      setResults(await getResults(tournament.id));
    } catch {
      /* results are best-effort; ignore load failures */
    }
  }, [canWrite, tournament.id]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  const resultFor = (memberId: string) =>
    results.find((r) => String(r.user_id) === memberId);

  // ----- read-only display (signed-out / non-organiser) -----
  if (!canWrite) {
    if (confirmed.length === 0) return null;
    return (
      <div className="confirmed-players">
        <span className="confirmed-label">Confirmed players ({confirmed.length})</span>
        <ul className="player-badges">
          {confirmed.map((m) => {
            const card = cardFor(`${tournament.id}:${m.id}`);
            return (
              <li key={m.id} className="player-badge">
                <span className={`card-bullet card-${card.suit.tone}`} aria-hidden="true">
                  {card.rank}
                  {card.suit.char}
                </span>
                {m.name}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // ----- organiser game controls -----
  const isComplete = tournament.status === "complete";
  const unconfirmed = members.filter((m) => !confirmedIds.includes(m.id));

  const addPlayer = async (memberId: string) => {
    if (!memberId) return;
    try {
      setBusy(memberId);
      setError(null);
      await confirmPlayer(tournament.id, memberId);
      setAddId("");
      await refresh();
    } catch (e: any) {
      setError(e.message || "Failed to add player");
    } finally {
      setBusy(null);
    }
  };

  const removePlayer = async (memberId: string) => {
    try {
      setBusy(memberId);
      setError(null);
      await unconfirmPlayer(tournament.id, memberId);
      if (openId === memberId) setOpenId(null);
      await refresh();
      await loadResults();
    } catch (e: any) {
      setError(e.message || "Failed to remove player");
    } finally {
      setBusy(null);
    }
  };

  const finishGame = async () => {
    const winner = results.find((r) => r.finish_place === 1);
    if (!winner && !confirm("No 1st-place finish recorded yet. Finish the game anyway?")) return;
    try {
      setBusy("finish");
      setError(null);
      await updateTournament(tournament.id, {
        name: tournament.name,
        date: tournament.date,
        venue: tournament.venue,
        address: tournament.address ?? "",
        players: confirmed.length || tournament.players,
        buyIn: tournament.buyIn ?? 0,
        prizePool: tournament.prizePool,
        status: "complete",
        winnerId: winner ? String(winner.user_id) : tournament.winnerId,
        hostId: tournament.hostId,
      });
      await refresh();
    } catch (e: any) {
      setError(e.message || "Failed to finish game");
    } finally {
      setBusy(null);
    }
  };

  const reopenGame = async () => {
    try {
      setBusy("finish");
      setError(null);
      await updateTournament(tournament.id, {
        name: tournament.name,
        date: tournament.date,
        venue: tournament.venue,
        address: tournament.address ?? "",
        players: tournament.players,
        buyIn: tournament.buyIn ?? 0,
        prizePool: tournament.prizePool,
        status: "live",
        winnerId: tournament.winnerId,
        hostId: tournament.hostId,
      });
      await refresh();
    } catch (e: any) {
      setError(e.message || "Failed to reopen game");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="confirmed-players game-roster">
      <span className="confirmed-label">
        Players ({confirmed.length}){" "}
        <small className="roster-hint">tap a player to record bullets, place &amp; winnings</small>
      </span>
      {confirmed.length > 0 && (
        <ul className="player-badges">
          {confirmed.map((m) => {
            const card = cardFor(`${tournament.id}:${m.id}`);
            const r = resultFor(m.id);
            const bullets = r ? Math.max(1, Math.round(r.buy_in_total / bulletCost(tournament))) : 0;
            return (
              <li
                key={m.id}
                className={`player-badge badge-interactive${openId === m.id ? " open" : ""}`}
              >
                <button
                  type="button"
                  className="badge-tap"
                  onClick={() => setOpenId((cur) => (cur === m.id ? null : m.id))}
                >
                  <span className={`card-bullet card-${card.suit.tone}`} aria-hidden="true">
                    {card.rank}
                    {card.suit.char}
                  </span>
                  {m.name}
                  {r && placeMedal(r.finish_place) && (
                    <span className="badge-medal">{placeMedal(r.finish_place)}</span>
                  )}
                  {bullets > 1 && (
                    <span
                      className="badge-bullets"
                      title={`${bullets} bullets`}
                      aria-label={`${bullets} bullets`}
                    >
                      {"\uD83C\uDFAF".repeat(bullets)}
                    </span>
                  )}
                  {r && r.cash_out > 0 && <span className="badge-won">{gbp(r.cash_out)}</span>}
                </button>
                {!isComplete && (
                  <button
                    type="button"
                    className="badge-remove"
                    onClick={() => removePlayer(m.id)}
                    disabled={busy === m.id}
                    aria-label={`Remove ${m.name}`}
                    title="Remove player"
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {openId && (() => {
        const m = confirmed.find((c) => c.id === openId);
        if (!m) return null;
        return (
          <ResultEditor
            tournament={tournament}
            member={m}
            existing={resultFor(m.id)}
            onClose={() => setOpenId(null)}
            onSaved={async () => {
              setOpenId(null);
              await loadResults();
              await refresh();
            }}
          />
        );
      })()}

      <div className="roster-actions">
        {!isComplete && unconfirmed.length > 0 && (
          <div className="roster-add">
            <select
              value={addId}
              onChange={(e) => {
                const id = e.target.value;
                setAddId(id);
                if (id) void addPlayer(id);
              }}
              disabled={busy !== null}
            >
              <option value="">+ Add player…</option>
              {unconfirmed.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {!isComplete ? (
          <button
            type="button"
            className="btn-save"
            onClick={finishGame}
            disabled={busy !== null}
          >
            {busy === "finish" ? "Finishing…" : "Finish game"}
          </button>
        ) : (
          <button
            type="button"
            className="btn-ghost"
            onClick={reopenGame}
            disabled={busy !== null}
          >
            {busy === "finish" ? "Reopening…" : "Reopen game"}
          </button>
        )}
      </div>
      {error && <p className="admin-note err">{error}</p>}
    </div>
  );
}

// Button that clones a tournament into a fresh game on the same night.
function NewGameButton({
  id,
  refresh,
}: {
  id: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    try {
      setBusy(true);
      setError(null);
      await cloneTournament(id);
      await refresh();
    } catch (e: any) {
      setError(e.message || "Failed to create game");
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-ghost" onClick={onClick} disabled={busy}>
        {busy ? "Adding…" : "+ New game"}
      </button>
      {error && <span className="chip-err">{error}</span>}
    </>
  );
}

export default function Tournaments() {
  const { members, tournaments, user, refresh } = useClub();
  const canWrite = !!user && user.canWrite !== false;
  const [editingId, setEditingId] = useState<string | null>(null);

  // Book of previously-used venues and the address last associated with each,
  // used to autocomplete the venue name and auto-fill its address when editing.
  const venueBook = useMemo(() => buildVenueBook(tournaments), [tournaments]);

  // The first game of each night (lowest id on that date) is the trophy game.
  const firstGameIds = useMemo(() => {
    const idNum = (id: string) => {
      const m = id.match(/\d+/g);
      return m ? Number(m.join("")) : 0;
    };
    const firstByDate = new Map<string, { id: string; n: number }>();
    for (const t of tournaments) {
      const n = idNum(t.id);
      const cur = firstByDate.get(t.date);
      if (!cur || n < cur.n) firstByDate.set(t.date, { id: t.id, n });
    }
    return new Set([...firstByDate.values()].map((v) => v.id));
  }, [tournaments]);

  // A night is "over" from 5am the morning after the game date.
  const nightIsOver = (date: string): boolean => {
    const cutoff = new Date(`${date}T05:00:00`);
    cutoff.setDate(cutoff.getDate() + 1);
    return Date.now() >= cutoff.getTime();
  };

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
                  venueBook={venueBook}
                  refresh={refresh}
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
                    {/* Fix 3: whiteSpace nowrap prevents status text from wrapping */}
                    <span className={`status status-${t.status}`} style={{ whiteSpace: "nowrap" }}>
                      {t.status === "live" && <span className="live-dot" />}
                      {statusLabel[t.status]}
                    </span>
                    <span className="tournament-date">{formatDate(t.date)}</span>
                  </div>
                  <h3 className="tournament-name">
                    {firstGameIds.has(t.id) && (
                      <span className="trophy-icon" title="Trophy game — first game of the night">
                        🏆{" "}
                      </span>
                    )}
                    {t.name}
                  </h3>
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
                      {!nightIsOver(t.date) && (
                        <NewGameButton id={t.id} refresh={refresh} />
                      )}
                      {!nightIsOver(t.date) && (
                        <DeleteButton id={t.id} name={t.name} refresh={refresh} />
                      )}
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
                      {t.status === "complete" && t.winnerId ? (
                        <Link className="player-link" to={`/player/${t.winnerId}`}>
                          {winnerName(members, t.winnerId)}
                        </Link>
                      ) : t.status === "complete" ? (
                        winnerName(members, t.winnerId)
                      ) : (
                        "—"
                      )}
                    </span>
                    <span className="tm-label">Winner</span>
                  </div>
                  {t.hostId && (
                    <div>
                      <span className="tm-value">
                        <Link className="player-link" to={`/player/${t.hostId}`}>
                          {winnerName(members, t.hostId)}
                        </Link>
                      </span>
                      <span className="tm-label">Host</span>
                    </div>
                  )}
                </div>

                <GameRoster
                  tournament={t}
                  members={members}
                  canWrite={canWrite}
                  refresh={refresh}
                />

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
  venueBook,
  refresh,
  onDone,
  onCancel,
}: {
  tournament: Tournament;
  members: Member[];
  venueBook: VenueBook;
  refresh: () => Promise<void>;
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
    hostId: tournament.hostId,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null);

  const set = (patch: Partial<NewTournament>) => setForm((f) => ({ ...f, ...patch }));

  const confirmedIds = tournament.confirmedPlayerIds ?? [];

  const toggleConfirm = async (memberId: string, isOn: boolean) => {
    try {
      setConfirmBusy(memberId);
      setError(null);
      if (isOn) await unconfirmPlayer(tournament.id, memberId);
      else await confirmPlayer(tournament.id, memberId);
      await refresh();
    } catch (e: any) {
      setError(e.message || "Failed to update confirmation");
    } finally {
      setConfirmBusy(null);
    }
  };

  const save = async () => {
    if (!form.name.trim() || !form.date) {
      setError("Name and date are required.");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await updateTournament(tournament.id, {
        ...form,
        players: Number(form.players) || 0,
        prizePool: Number(form.prizePool) || 0,
      });
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
          <input
            list="venue-suggestions"
            value={form.venue}
            onChange={(e) => {
              const venue = e.target.value;
              const known = venueBook.addressByVenue.get(venue.trim().toLowerCase());
              set(known ? { venue, address: known } : { venue });
            }}
          />
          <datalist id="venue-suggestions">
            {venueBook.options.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label className="narrow">
          Players
          <input
            type="number"
            value={Number.isNaN(form.players) ? "" : form.players}
            onChange={(e) => set({ players: e.target.value === "" ? NaN : Number(e.target.value) })}
          />
        </label>
        <label className="narrow">
          Prize £
          <input
            type="number"
            value={Number.isNaN(form.prizePool) ? "" : form.prizePool}
            onChange={(e) => set({ prizePool: e.target.value === "" ? NaN : Number(e.target.value) })}
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
      <div className="admin-row">
        <label className="grow">
          Host
          <select
            value={form.hostId ?? ""}
            onChange={(e) => set({ hostId: e.target.value || undefined })}
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
      <fieldset className="confirm-fieldset">
        <legend>Confirmed players</legend>
        <div className="confirm-grid">
          {members.map((m) => {
            const isOn = confirmedIds.includes(m.id);
            return (
              <label key={m.id} className="confirm-check">
                <input
                  type="checkbox"
                  checked={isOn}
                  disabled={confirmBusy === m.id}
                  onChange={() => toggleConfirm(m.id, isOn)}
                />
                {m.name}
              </label>
            );
          })}
          {members.length === 0 && <p className="admin-note">No members yet.</p>}
        </div>
      </fieldset>
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
