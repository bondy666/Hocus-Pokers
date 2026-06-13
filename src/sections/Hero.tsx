import { CLUB, headlineStats, gbp } from "../data.ts";
import { useClub } from "../ClubContext.ts";
import { loginUrl, logoutUrl } from "../api.ts";

export default function Hero() {
  const { members, tournaments, user, authChecked } = useClub();
  const stats = headlineStats(members, tournaments);
  const cards = [
    { value: String(stats.members), label: "Members" },
    { value: String(stats.tournaments), label: "Tournaments" },
    { value: gbp(stats.prizePool), label: "Prize pool tracked" },
    { value: String(stats.years), label: "Years running" },
  ];

  return (
    <section className="hero" id="hero">
      <div className="hero-inner">
        <img className="hero-logo" src="/logo.png" alt="Hocus Pokers club logo" width={132} height={132} />
        <p className="hero-eyebrow">Est. {CLUB.foundedYear} · {CLUB.location}</p>
        <h1 className="hero-title">
          {CLUB.name}
          <span className="hero-suits">♠ ♥ ♣ ♦</span>
        </h1>
        <p className="hero-tagline">{CLUB.tagline}</p>

        <div className="hero-auth">
          {!authChecked ? (
            <span className="hero-auth-hint">Checking sign-in…</span>
          ) : user ? (
            <div className="hero-auth-signed">
              <span className="hero-auth-info">
                Signed in as <strong>{user.name || user.email}</strong>
              </span>
              <a className="hero-signout" href={logoutUrl()}>
                Sign out
              </a>
            </div>
          ) : (
            <div className="hero-login-buttons">
              <a className="login-btn google" href={loginUrl("google")}>
                <span className="login-icon">G</span> Sign in with Google
              </a>
              <a className="login-btn microsoft" href={loginUrl("aad")}>
                <span className="login-icon">⊞</span> Sign in with Microsoft
              </a>
            </div>
          )}
        </div>

        <div className="stat-row">
          {cards.map((c) => (
            <div className="stat-card" key={c.label}>
              <div className="stat-value">{c.value}</div>
              <div className="stat-label">{c.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
