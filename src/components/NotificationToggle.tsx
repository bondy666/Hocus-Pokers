import { useEffect, useState } from "react";
import {
  getPushConfig,
  savePushSubscription,
  removePushSubscription,
} from "../api.ts";

// Convert a base64url VAPID key into the Uint8Array the Push API expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type State = "loading" | "unsupported" | "denied" | "off" | "on" | "busy";

export default function NotificationToggle() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supported) {
        if (active) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (active) setState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (active) setState(sub ? "on" : "off");
      } catch {
        if (active) setState("off");
      }
    })();
    return () => {
      active = false;
    };
  }, [supported]);

  async function enable() {
    setError(null);
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const config = await getPushConfig();
      if (!config.enabled || !config.key) {
        setError("Notifications aren't configured on the server yet.");
        setState("off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.key),
      });
      await savePushSubscription(sub.toJSON());
      setState("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't enable notifications.");
      setState("off");
    }
  }

  async function disable() {
    setError(null);
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
      setState("off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn notifications off.");
      setState("on");
    }
  }

  if (state === "loading") return null;

  return (
    <div className="notify-toggle">
      <div className="notify-toggle-head">
        <span className="notify-toggle-icon" aria-hidden="true">🔔</span>
        <div>
          <strong>Phone notifications</strong>
          <p className="notify-toggle-sub">
            Get a buzz for new tournaments and fresh banter.
          </p>
        </div>
      </div>

      {state === "unsupported" && (
        <p className="notify-toggle-note">
          This browser doesn't support push notifications. On iPhone, add this site
          to your Home Screen first, then enable them from there.
        </p>
      )}

      {state === "denied" && (
        <p className="notify-toggle-note">
          Notifications are blocked. Re-enable them for this site in your browser
          settings to turn them on.
        </p>
      )}

      {state === "off" && (
        <button type="button" className="btn-save" onClick={enable}>
          Turn on notifications
        </button>
      )}

      {state === "on" && (
        <button type="button" className="btn-ghost" onClick={disable}>
          ✓ On — tap to turn off
        </button>
      )}

      {state === "busy" && (
        <button type="button" className="btn-ghost" disabled>
          Working…
        </button>
      )}

      {error && <p className="notify-toggle-error">{error}</p>}
    </div>
  );
}
