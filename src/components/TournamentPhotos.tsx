import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  getPhotos,
  uploadPhotos,
  deletePhoto,
  type TournamentPhoto,
} from "../api.ts";
import { useClub } from "../ClubContext.ts";

export default function TournamentPhotos({ tournamentId }: { tournamentId: string }) {
  const { user, source } = useClub();
  const canUpload = !!user && source !== "seed";
  const canDelete = !!user && user.canWrite !== false;

  const [photos, setPhotos] = useState<TournamentPhoto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<TournamentPhoto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const data = await getPhotos(tournamentId);
      setPhotos(data);
    } catch {
      // ignore — gallery just stays empty
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      setBusy(true);
      setError(null);
      await uploadPhotos(tournamentId, files);
      await load();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDelete = async (id: number) => {
    if (!confirm("Delete this photo?")) return;
    try {
      setBusy(true);
      setError(null);
      await deletePhoto(id);
      setPhotos((p) => p.filter((x) => x.id !== id));
    } catch (err: any) {
      setError(err.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded && photos.length === 0) return null;

  // Hide the whole block if there's nothing to show and the user can't upload.
  if (photos.length === 0 && !canUpload) return null;

  return (
    <div className="photo-block">
      <div className="photo-head">
        <span className="photo-title">
          📷 Photos from the night{photos.length > 0 ? ` (${photos.length})` : ""}
        </span>
        {canUpload && (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? "Uploading…" : "Upload photos"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={onPick}
            />
          </>
        )}
      </div>

      {error && <p className="chip-err">{error}</p>}

      {photos.length > 0 ? (
        <div className="photo-grid">
          {photos.map((p) => (
            <figure className="photo-thumb" key={p.id}>
              <button type="button" className="photo-open" onClick={() => setLightbox(p)}>
                <img src={p.url} alt={p.caption || "Tournament photo"} loading="lazy" />
              </button>
              {canDelete && (
                <button
                  type="button"
                  className="photo-del"
                  title="Delete photo"
                  onClick={() => onDelete(p.id)}
                  disabled={busy}
                >
                  ✕
                </button>
              )}
            </figure>
          ))}
        </div>
      ) : (
        canUpload && <p className="photo-empty">No photos yet — be the first to add some.</p>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <button type="button" className="lightbox-close" aria-label="Close">
            ✕
          </button>
          <img src={lightbox.url} alt={lightbox.caption || "Tournament photo"} />
          {lightbox.uploadedBy && (
            <p className="lightbox-meta">Added by {lightbox.uploadedBy}</p>
          )}
        </div>
      )}
    </div>
  );
}
