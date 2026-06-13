import { useEffect, useState, useCallback } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Link,
  Outlet,
  Navigate,
  useLocation,
} from "react-router-dom";
import Hero from "./sections/Hero.tsx";
import Leaderboard from "./sections/Leaderboard.tsx";
import Members from "./sections/Members.tsx";
import Tournaments from "./sections/Tournaments.tsx";
import PlanNight from "./sections/PlanNight.tsx";
import Statistics from "./sections/Statistics.tsx";
import CardRoom from "./sections/CardRoom.tsx";
import HouseRules from "./sections/HouseRules.tsx";
import Admin from "./sections/Admin.tsx";
import { CLUB, members as seedMembers, tournaments as seedTournaments } from "./data.ts";
import { ClubContext, type ClubContextValue } from "./ClubContext.ts";
import { loadClubData, getCurrentUser } from "./api.ts";

const nav = [
  { to: "/", label: "Home", end: true },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/members", label: "Members" },
  { to: "/tournaments", label: "Tournaments" },
  { to: "/plan", label: "Plan Night" },
  { to: "/stats", label: "Club Stats" },
  { to: "/cardroom", label: "Card Room" },
  { to: "/rules", label: "House Rules" },
  { to: "/admin", label: "Score Keeper" },
];

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="app">
      <ScrollToTop />
      <header className="topbar">
        <Link className="brand" to="/">
          <img className="brand-logo" src="/logo.png" alt="" width={40} height={40} />
          {CLUB.name}
        </Link>

        <button
          type="button"
          className="nav-toggle"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="nav-toggle-bar" />
          <span className="nav-toggle-bar" />
          <span className="nav-toggle-bar" />
        </button>

        <nav className={`topnav ${open ? "open" : ""}`}>
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `nav-btn ${isActive ? "active" : ""}`}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main id="top">
        {pathname !== "/" && (
          <div className="page-brand">
            <img className="page-brand-logo" src="/logo.png" alt="Hocus Pokers" width={72} height={72} />
          </div>
        )}
        <Outlet />
      </main>

      <footer className="footer">
        <span className="brand-suit">♣</span>
        <p>
          {CLUB.name} · {CLUB.location} · Established {CLUB.foundedYear}
        </p>
        <p className="footer-fine">
          Members club stats tracker. Please gamble responsibly — and tip your dealer.
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  const [club, setClub] = useState<ClubContextValue>({
    members: seedMembers,
    tournaments: seedTournaments,
    source: "seed",
    user: null,
    authChecked: false,
    refresh: async () => {},
  });

  const refresh = useCallback(async () => {
    const data = await loadClubData();
    setClub((prev) => ({ ...prev, ...data, refresh }));
  }, []);

  useEffect(() => {
    let active = true;
    loadClubData().then((data) => {
      if (active) setClub((prev) => ({ ...prev, ...data, refresh }));
    });
    getCurrentUser().then((user) => {
      if (active) setClub((prev) => ({ ...prev, user, authChecked: true }));
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  return (
    <ClubContext.Provider value={club}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Hero />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="members" element={<Members />} />
            <Route path="tournaments" element={<Tournaments />} />
            <Route path="plan" element={<PlanNight />} />
            <Route path="stats" element={<Statistics />} />
            <Route path="cardroom" element={<CardRoom />} />
            <Route path="rules" element={<HouseRules />} />
            <Route path="admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ClubContext.Provider>
  );
}
