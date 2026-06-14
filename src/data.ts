export interface Trophy {
  id: string;
  label: string;
  emoji: string;
  note?: string;
}

export interface Member {
  id: string;
  name: string;
  nickname: string;
  location: string;
  email?: string;
  avatarUrl?: string;
  joined: number; // year
  netPnl: number; // career net profit/loss in GBP
  wins: number; // tournaments won
  games: number; // tournaments played
  trophies: Trophy[];
}

export type TournamentStatus = "live" | "upcoming" | "complete";

export interface Tournament {
  id: string;
  name: string;
  date: string; // ISO date
  venue: string;
  address?: string; // full street address for the venue
  players: number;
  prizePool: number; // GBP
  status: TournamentStatus;
  winnerId?: string;
  hostId?: string;
}

export const CLUB = {
  name: "Hocus Pokers",
  tagline: "Ealing's home of felt, chips and friendly larceny",
  foundedYear: 2019,
  location: "Ealing, London",
};

export const members: Member[] = [
  { id: "m-raghav", name: "Raghav Dhir", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-mgarratt", name: "Matt Garratt", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-jhalpenny", name: "Jon Halpenny", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-ceastwood", name: "Chris Eastwood", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-sbond", name: "Simon Bond", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-mrichardson", name: "Matt Richardson", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-kbal", name: "Kamal Bal", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
];

export const tournaments: Tournament[] = [
  {
    id: "tn-12",
    name: "Summer Felt Classic",
    date: "2026-06-13",
    venue: "The Card Room, Ealing",
    players: 18,
    prizePool: 900,
    status: "live",
  },
  {
    id: "tn-13",
    name: "Midsummer Bounty Brawl",
    date: "2026-06-27",
    venue: "The Card Room, Ealing",
    players: 16,
    prizePool: 800,
    status: "upcoming",
  },
  {
    id: "tn-14",
    name: "Hocus Pokers Main Event 2026",
    date: "2026-07-18",
    venue: "Ealing Town Hall",
    players: 24,
    prizePool: 2400,
    status: "upcoming",
  },
  {
    id: "tn-11",
    name: "Spring Deepstack",
    date: "2026-05-16",
    venue: "The Card Room, Ealing",
    players: 20,
    prizePool: 1000,
    status: "complete",
  },
  {
    id: "tn-10",
    name: "April Freezeout",
    date: "2026-04-25",
    venue: "The Card Room, Ealing",
    players: 17,
    prizePool: 850,
    status: "complete",
  },
  {
    id: "tn-09",
    name: "Christmas Cracker 2025",
    date: "2025-12-20",
    venue: "Ealing Town Hall",
    players: 22,
    prizePool: 1320,
    status: "complete",
  },
  {
    id: "tn-08",
    name: "Autumn Bounty Night",
    date: "2025-11-08",
    venue: "The Card Room, Ealing",
    players: 19,
    prizePool: 950,
    status: "complete",
  },
];

export const houseRules: { title: string; body: string }[] = [
  {
    title: "One player per hand",
    body: "No table talk on a live hand. Coaching, soft-play and 'helpful' advice will earn you a friendly fine to the snack fund.",
  },
  {
    title: "Chips stay visible",
    body: "Keep your stack stacked and countable. No hiding big chips behind the wall — the wall belongs to the felt.",
  },
  {
    title: "Cards speak",
    body: "Tabled hands are read by the room. Mucked hands lose, even if you misread them. Protect your cards.",
  },
  {
    title: "Verbal is binding",
    body: "If you say it in turn, you own it. 'Raise', 'call' and 'all-in' are commitments, not vibes.",
  },
  {
    title: "Buy-ins before cards",
    body: "Settle your buy-in or rebuy with the cashier before the next hand is dealt. The blinds wait for no one.",
  },
  {
    title: "Leave it on the felt",
    body: "Bad beats happen. Tilt quietly, tip the dealer, and bring it back next month. We're a club, not a casino.",
  },
];

export const venue = {
  name: "The Card Room",
  schedule: "Second & fourth Friday of each month · doors 7:00pm · cards in the air 7:30pm",
  buyIn:
    "£10 buy-in · up to three rebuys · no add-ons · rebuys completed within ~1.5 hrs of starting unless otherwise agreed",
};

// A combined "venue — address" label for a tournament, falling back to just the
// venue name when no address has been entered for it.
export const venueLine = (t?: Tournament | null): string => {
  if (!t) return "";
  return t.address ? `${t.venue} — ${t.address}` : t.venue;
};

const formatNightDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

// The next scheduled game: a live tournament, else the soonest upcoming/future date.
export const nextTournament = (tournaments: Tournament[]): Tournament | null => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const upcoming = [...tournaments]
    .filter((t) => t.status !== "complete")
    .filter((t) => t.status === "live" || t.status === "upcoming" || t.date >= todayIso)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  return upcoming.find((t) => t.status === "live") ?? upcoming[0] ?? null;
};

// A schedule line that reflects the next game, falling back to the default cadence.
export const nextScheduleLine = (tournaments: Tournament[]): string => {
  const next = nextTournament(tournaments);
  if (!next) return venue.schedule;
  const when = next.status === "live" ? "Live now" : `Next: ${formatNightDate(next.date)}`;
  return `${when} · ${next.name} · doors 7:00pm · cards in the air 7:30pm`;
};

// ----- derived helpers -----

export const winnerName = (members: Member[], id?: string): string =>
  members.find((m) => m.id === id)?.name ?? "TBD";

// Games played isn't tracked per attendee (only winners have result rows), so
// member profiles display a fixed club figure for games played.
export const PROFILE_GAMES: number = 50;

export const winRate = (m: Member): number =>
  m.games === 0 ? 0 : Math.round((m.wins / m.games) * 100);

// Win rate against the fixed profile games figure, for the member cards.
export const profileWinRate = (m: Member): number =>
  PROFILE_GAMES === 0 ? 0 : Math.round((m.wins / PROFILE_GAMES) * 100);

export const leaderboard = (members: Member[]): Member[] =>
  [...members].sort(
    (a, b) => b.wins - a.wins || b.netPnl - a.netPnl || b.games - a.games
  );

export const headlineStats = (members: Member[], tournaments: Tournament[]) => {
  const prizePool = tournaments.reduce((sum, t) => sum + t.prizePool, 0);
  const gamesPlayed = tournaments.filter((t) => t.status === "complete").length;
  return {
    members: members.length,
    tournaments: tournaments.length,
    gamesPlayed,
    prizePool,
    years: new Date().getFullYear() - CLUB.foundedYear,
  };
};

export const gbp = (n: number): string =>
  `${n < 0 ? "-" : ""}£${Math.abs(n).toLocaleString("en-GB")}`;
