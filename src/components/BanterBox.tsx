import { useEffect, useRef, useState, type FormEvent } from "react";
import { getBanter, postBanter, deleteBanter, type BanterMessage } from "../api.ts";
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
  const { user, source } = useClub();
  const canPost = !!user && source !== "seed";

  const [messages, setMessages] = useState<BanterMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
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
    if (!body) return;
    try {
      setBusy(true);
      setError(null);
      const msg = await postBanter(body);
      setMessages((m) => [...m, msg]);
      setText("");
    } catch (err: any) {
      setError(err.message || "Couldn't post that");
    } finally {
      setBusy(false);
    }
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
                <button
                  type="button"
                  className="banter-del"
                  title="Delete"
                  onClick={() => onDelete(m.id)}
                >
                  ✕
                </button>
              )}
            </div>
            <p className="banter-body">{m.body}</p>
          </div>
        ))}
      </div>

      {error && <p className="chip-err">{error}</p>}

      {canPost ? (
        <form className="banter-form" onSubmit={onSubmit}>
          <input
            type="text"
            className="banter-input"
            placeholder="Say something…"
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          <button type="submit" className="btn-save" disabled={busy || !text.trim()}>
            {busy ? "Posting…" : "Post"}
          </button>
        </form>
      ) : (
        <p className="banter-signin">Sign in on the Trophy Room page to join the banter.</p>
      )}
    </div>
  );
}
