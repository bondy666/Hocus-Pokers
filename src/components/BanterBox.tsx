import { useEffect, useRef, useState, type FormEvent } from "react";
import { getBanter, postBanter, updateBanter, deleteBanter, type BanterMessage } from "../api.ts";
import { useClub } from "../ClubContext.ts";

const MAX = 500;

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function BanterBox() {
  const { user, source, members } = useClub();
  const canPost = !!user && source !== "seed";

  const [messages, setMessages] = useState<BanterMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      setMessages(await getBanter());
    } catch {
      // stays empty
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    // Keep the newest message in view.
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !authorName) return;
    try {
      setBusy(true);
      setError(null);
      if (editingId !== null) {
        const msg = await updateBanter(editingId, body, authorName);
        setMessages((m) => m.map((item) => item.id === msg.id ? msg : item));
      } else {
        const msg = await postBanter(body, authorName);
        setMessages((m) => [...m, msg]);
      }
      setText("");
      setAuthorName("");
      setEditingId(null);
    } catch (err: any) {
      setError(err.message || "Couldn't post that");
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (message: BanterMessage) => {
    setEditingId(message.id);
    setText(message.body);
    setAuthorName(message.author);
    setError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setText("");
    setAuthorName("");
  };

  const onDelete = async (id: number) => {
    try {
      await deleteBanter(id);
      setMessages((m) => m.filter((x) => x.id !== id));
    } catch (err: any) {
      setError(err.message || "Couldn't delete that");
    }
  };

  return (
    <div className="banter">
      <div className="banter-head">
        <h3 className="banter-title">🗣️ Bants</h3>
        <span className="banter-sub">"That's what she said", Beadle's hand, et cetera.</span>
      </div>

      <div className="banter-thread" ref={threadRef}>
        {!loaded && <p className="banter-empty">Loading the chatter…</p>}
        {loaded && messages.length === 0 && (
          <p className="banter-empty">No banter yet — someone has to go first.</p>
        )}
        {messages.map((m) => (
          <div className={`banter-msg ${m.mine ? "mine" : ""}`} key={m.id}>
            <div className="banter-meta">
              <span className="banter-author">{m.author}</span>
              <span className="banter-time">{timeAgo(m.createdAt)}</span>
              {m.mine && (
                <span className="banter-actions">
                  <button type="button" className="banter-edit" onClick={() => startEditing(m)}>
                    Edit
                  </button>
                  <button type="button" className="banter-del" title="Delete" onClick={() => onDelete(m.id)}>
                    ✕
                  </button>
                </span>
              )}
            </div>
            <p className="banter-body">{m.body}</p>
          </div>
        ))}
      </div>

      {error && <p className="chip-err">{error}</p>}

      {canPost ? (
        <form className="banter-form" onSubmit={onSubmit}>
          <select
            className="banter-author-select"
            aria-label="Who said it?"
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            disabled={busy}
          >
            <option value="">Who said it?</option>
            {members.map((member) => (
              <option key={member.id} value={member.name}>{member.name}</option>
            ))}
            {authorName && !members.some((member) => member.name === authorName) && (
              <option value={authorName}>{authorName}</option>
            )}
            {user.name && !members.some((member) => member.name === user.name) && (
              <option value={user.name}>{user.name}</option>
            )}
          </select>
          <input
            type="text"
            className="banter-input"
            placeholder="Say something…"
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn-save" disabled={busy || !text.trim() || !authorName}>
            {busy ? (editingId !== null ? "Saving…" : "Posting…") : editingId !== null ? "Save" : "Post"}
          </button>
          {editingId !== null && (
            <button type="button" className="btn-ghost" onClick={cancelEditing} disabled={busy}>Cancel</button>
          )}
        </form>
      ) : (
        <p className="banter-signin">Sign in on the Trophy Room page to join the banter.</p>
      )}
    </div>
  );
}
