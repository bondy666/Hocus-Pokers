// Fallback seed data used when no SQL database is configured.
// Mirrors the API response shapes the frontend expects.

export interface MemberDto {
  id: string;
  name: string;
  nickname: string;
  location: string;
  email?: string;
  avatarUrl?: string;
  joined: number;
  netPnl: number;
  wins: number;
  games: number;
  trophies: { id: string; label: string; emoji: string }[];
}

export interface TournamentDto {
  id: string;
  name: string;
  date: string;
  venue: string;
  address?: string;
  players: number;
  prizePool: number;
  status: "live" | "upcoming" | "complete";
  winnerId?: string;
}

export const members: MemberDto[] = [
  { id: "m-raghav", name: "Raghav Dhir", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-mgarratt", name: "Matt Garratt", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-jhalpenny", name: "Jon Halpenny", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-ceastwood", name: "Chris Eastwood", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-sbond", name: "Simon Bond", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-mrichardson", name: "Matt Richardson", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
  { id: "m-kbal", name: "Kamal Bal", nickname: "", location: "Ealing", email: "", joined: 2019, netPnl: 0, wins: 0, games: 0, trophies: [] },
];

export const tournaments: TournamentDto[] = [
  { id: "tn-12", name: "Summer Felt Classic", date: "2026-06-13", venue: "The Card Room, Ealing", players: 18, prizePool: 900, status: "live" },
  { id: "tn-13", name: "Midsummer Bounty Brawl", date: "2026-06-27", venue: "The Card Room, Ealing", players: 16, prizePool: 800, status: "upcoming" },
  { id: "tn-14", name: "Hocus Pokers Main Event 2026", date: "2026-07-18", venue: "Ealing Town Hall", players: 24, prizePool: 2400, status: "upcoming" },
  { id: "tn-11", name: "Spring Deepstack", date: "2026-05-16", venue: "The Card Room, Ealing", players: 20, prizePool: 1000, status: "complete" },
  { id: "tn-10", name: "April Freezeout", date: "2026-04-25", venue: "The Card Room, Ealing", players: 17, prizePool: 850, status: "complete" },
  { id: "tn-09", name: "Christmas Cracker 2025", date: "2025-12-20", venue: "Ealing Town Hall", players: 22, prizePool: 1320, status: "complete" },
  { id: "tn-08", name: "Autumn Bounty Night", date: "2025-11-08", venue: "The Card Room, Ealing", players: 19, prizePool: 950, status: "complete" },
];

export function leaderboard(): MemberDto[] {
  return [...members].sort((a, b) => b.netPnl - a.netPnl);
}
