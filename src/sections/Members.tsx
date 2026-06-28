import { useState, useRef, type FormEvent, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { gbp, winRate, type Member } from "../data.ts";
import { useClub } from "../ClubContext.ts";
import {
  createMember,
  updateMember,
  deleteMember,
  uploadMemberAvatar,
  awardTrophy,
  deleteTrophy,
  type NewMember,
} from "../api.ts";

const blankMember: NewMember = {
  name: "",
  nickname: "",
  location: "Ealing",
  email: "",
  joined: new Date().getFullYear(),
  games: 50,
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export default function Members() {
  const { members, source, user, refresh } = useClub();
  const canManage = !!user && source !== "seed";

  const [adding, setAdding] = useState(false);

  return (
    <section className="section" id="members">
      <div className="section-inner">
        <h2 className="section-title">Member Profiles</h2>
        <p className="section-sub">The regulars. One felt. Endless bad beats.</p>

        {canManage && !adding && (
          <div className="member-actions">
            <button type="button" className="btn-save" onClick={() => setAdding(true)}>
              + Add member
            </button>
          </div>
        )}

        {!user && source !== "seed" && (
          <p className="member-hint">
            Sign in on the Trophy Room page to add or update members.
          </p>
        )}

        {canManage && adding && (
          <MemberForm
            title="Add a member"
            initial={blankMember}
            submitLabel="Add member"
            onCancel={() => setAdding(false)}
            onSubmit={async (form) => {
              await createMember({ ...form, joined: Number(form.joined) || undefined });
              await refresh();
              setAdding(false);
            }}
          />
        )}

        <div className="member-grid">
          {members.map((m) => (
            <MemberCard key={m.id} member={m} canManage={canManage} refresh={refresh} />
          ))}
        </div>
      </div>
    </section>
  );
}

function MemberCard({
  member,
  canManage,
  refresh,
}: {
  member: Member;
  canManage: boolean;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <article className="member-card editing">
        <MemberForm
          title={`Edit ${member.name}`}
          memberId={member.id}
          memberName={member.name}
          avatarUrl={member.avatarUrl}
          initial={{
            name: member.name,
            nickname: member.nickname,
            location: member.location,
            email: member.email ?? "",
            joined: member.joined,
            games: member.games,
          }}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (form) => {
            await updateMember(member.id, {
              ...form,
              joined: Number(form.joined) || undefined,
              games: Number(form.games) || 0,
            });
            await refresh();
            setEditing(false);
          }}
        />
        <TrophyManager member={member} refresh={refresh} />
        <div className="member-card-actions danger-zone">
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              if (!confirm(`Delete ${member.name}? This cannot be undone.`)) return;
              try {
                await deleteMember(member.id);
                await refresh();
              } catch (err) {
                alert((err as Error).message);
              }
            }}
          >
            Delete member
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="member-card">
      <header className="member-head">
        <div className="member-head-left">
          <div className="member-avatar">
            {member.avatarUrl ? (
              <img src={member.avatarUrl} alt={member.name} />
            ) : (
              <span className="member-avatar-fallback">{initials(member.name)}</span>
            )}
          </div>
          <div>
            <h3 className="member-name">
              <Link className="player-link" to={`/player/${member.id}`}>
                {member.name}
              </Link>
            </h3>
            <p className="member-meta">
              {member.nickname ? `“${member.nickname}” · ` : ""}
              {member.location} · since {member.joined}
            </p>
            {member.email && <p className="member-email">✉ {member.email}</p>}
          </div>
        </div>
        <div className={`member-pnl ${member.netPnl >= 0 ? "pos" : "neg"}`}>
          {gbp(member.netPnl)}
        </div>
      </header>

      <div className="member-stats">
        <div>
          <span className="ms-value">{member.wins}</span>
          <span className="ms-label">Wins</span>
        </div>
        <div>
        <span className="ms-value">{member.games}</span>
          <span className="ms-label">Games</span>
        </div>
        <div>
        <span className="ms-value">{winRate(member)}%</span>
          <span className="ms-label">Win rate</span>
        </div>
      </div>

      <div className="trophy-row">
        {member.trophies.map((t) => (
          <span className="trophy" key={t.id} title={t.label}>
            <span className="trophy-emoji">{t.emoji}</span>
            {t.label}
          </span>
        ))}
      </div>

      {canManage && (
        <div className="member-card-actions">
          <button type="button" className="btn-ghost" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      )}
    </article>
  );
}

function MemberForm({
  title,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  memberId,
  memberName,
  avatarUrl,
}: {
  title: string;
  initial: NewMember;
  submitLabel: string;
  onSubmit: (form: NewMember) => Promise<void>;
  onCancel: () => void;
  memberId?: string;
  memberName?: string;
  avatarUrl?: string;
}) {
  const { refresh } = useClub();
  const [form, setForm] = useState<NewMember>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(avatarUrl || null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !memberId) return;
    try {
      setUploading(true);
      setError(null);
      const { avatarUrl: url } = await uploadMemberAvatar(memberId, file);
      setPreview(url);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      await onSubmit({ ...form, name: form.name.trim() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="member-form" onSubmit={submit}>
      <h3 className="member-form-title">{title}</h3>

      {memberId && (
        <div className="avatar-edit">
          <div className="member-avatar lg">
            {preview ? (
              <img src={preview} alt={memberName || "Member"} />
            ) : (
              <span className="member-avatar-fallback">{initials(memberName || form.name)}</span>
            )}
          </div>
          <div className="avatar-edit-controls">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : preview ? "Change photo" : "Upload photo"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onPickAvatar}
            />
            <span className="avatar-edit-hint">JPG or PNG, up to 12MB.</span>
          </div>
        </div>
      )}

      <label className="member-field">
        <span>Name</span>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Full name"
          required
        />
      </label>

      <div className="member-field-row">
        <label className="member-field">
          <span>Nickname</span>
          <input
            type="text"
            value={form.nickname ?? ""}
            onChange={(e) => setForm({ ...form, nickname: e.target.value })}
            placeholder="optional"
          />
        </label>
        <label className="member-field">
          <span>Joined</span>
          <input
            type="number"
            value={form.joined ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                joined: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            min={1990}
            max={2100}
          />
        </label>
        <label className="member-field">
          <span>Games</span>
          <input
            type="number"
            value={form.games ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                games: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            min={0}
          />
        </label>
      </div>

      <label className="member-field">
        <span>Location</span>
        <input
          type="text"
          value={form.location ?? ""}
          onChange={(e) => setForm({ ...form, location: e.target.value })}
          placeholder="Town / area"
        />
      </label>

      <label className="member-field">
        <span>Login email</span>
        <input
          type="email"
          value={form.email ?? ""}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="name@example.com — used to sign in"
        />
      </label>

      {error && <p className="chip-err">{error}</p>}

      <div className="member-form-actions">
        <button type="submit" className="btn-save" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TrophyManager({
  member,
  refresh,
}: {
  member: Member;
  refresh: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [emoji, setEmoji] = useState("🏆");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    try {
      setBusy(true);
      setError(null);
      await awardTrophy(member.id, { label: label.trim(), emoji: emoji || "🏆" });
      setLabel("");
      setEmoji("🏆");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, lbl: string) {
    if (!confirm(`Remove trophy “${lbl}”?`)) return;
    try {
      setBusy(true);
      setError(null);
      await deleteTrophy(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="member-trophy-manager">
      <h4 className="member-form-subtitle">Trophies</h4>
      {member.trophies.length > 0 ? (
        <div className="trophy-row">
          {member.trophies.map((t) => (
            <span className="trophy editable" key={t.id} title={t.label}>
              <span className="trophy-emoji">{t.emoji}</span>
              {t.label}
              <button
                type="button"
                className="trophy-remove"
                onClick={() => remove(t.id, t.label)}
                disabled={busy}
                aria-label={`Remove ${t.label}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="stats-note">No trophies yet.</p>
      )}
      <form className="trophy-add-row" onSubmit={add}>
        <input
          className="trophy-add-emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          aria-label="Trophy emoji"
        />
        <input
          className="trophy-add-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add a trophy (e.g. Bluff of the Year)"
        />
        <button type="submit" className="btn-ghost" disabled={busy || !label.trim()}>
          Add
        </button>
      </form>
      {error && <p className="chip-err">{error}</p>}
    </div>
  );
}
