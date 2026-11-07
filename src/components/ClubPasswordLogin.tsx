import { useState, type FormEvent } from "react";
import { loginWithClubPassword } from "../api.ts";
import { useClub } from "../ClubContext.ts";

export default function ClubPasswordLogin({ redirectTo }: { redirectTo: string }) {
  const { members } = useClub();
  const [memberId, setMemberId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await loginWithClubPassword(memberId, password);
      window.location.assign(redirectTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
      setSubmitting(false);
    }
  }

  return (
    <form className="club-password-form" onSubmit={submit}>
      <p className="club-password-prompt">
        Club members: choose your name and enter the club password.
      </p>
      <select
        id="club-member-select"
        aria-label="Select your member name"
        value={memberId}
        onChange={(event) => setMemberId(event.target.value)}
        required
      >
        <option value="" disabled>Select your name</option>
        {members
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((member) => (
            <option key={member.id} value={member.id}>{member.name}</option>
          ))}
      </select>
      <input
        id="club-password"
        type="password"
        aria-label="Club password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Club password"
        required
      />
      <button className="login-btn club-password-button" type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      {error && <p className="club-password-error" role="alert">{error}</p>}
    </form>
  );
}
