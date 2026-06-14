import type { Member, Tournament } from "./data.ts";

// All Hall of Fame analytics are derived from the completed-game record:
// each completed tournament has a date, an optional winner and an optional
// host. Money/attendance isn't tracked, so "appearances" are based on the
// games a player is recorded in (as winner or host).

export interface ChampRow {
  id: string;
  name: string;
  wins: number;
}

export interface TimelineEntry {
  id: string;
  name: string;
  date: string;
  winnerId?: string;
  winnerName: string;
  hostId?: string;
  hostName: string;
  defence: "first" | "defended" | "lost" | "none";
}

export interface DroughtRow {
  id: string;
  name: string;
  longest: number; // games between wins (gap), longest in club history
  current: number; // completed games since their last win
  lastWin: string | null;
}

export interface HostRow {
  id: string;
  name: string;
  hosted: number;
}

export interface StreakRow {
  id: string;
  name: string;
  streak: number; // longest run of back-to-back wins
}

export interface AppearanceRow {
  id: string;
  name: string;
  first: string;
  last: string;
  span: number; // whole years between first and last appearance
}

export interface DefenceRow {
  id: string;
  name: string;
  attempts: number; // times they were reigning champ going into the next game
  successes: number; // back-to-back wins
}

export interface HallOfFame {
  totalGames: number;
  champions: ChampRow[];
  timeline: TimelineEntry[];
  droughts: DroughtRow[];
  hosts: HostRow[];
  streaks: StreakRow[];
  appearances: AppearanceRow[];
  defences: DefenceRow[];
}

export function buildHallOfFame(members: Member[], tournaments: Tournament[]): HallOfFame {
  const nameById = new Map(members.map((m) => [m.id, m.name]));
  const nameOf = (id?: string) => (id ? nameById.get(id) ?? "Unknown" : "—");

  // Completed games in chronological (oldest-first) order.
  const games = tournaments
    .filter((t) => t.status === "complete")
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));

  const totalGames = games.length;

  // --- Champions (most wins) ---
  const winCount = new Map<string, number>();
  for (const g of games) if (g.winnerId) winCount.set(g.winnerId, (winCount.get(g.winnerId) ?? 0) + 1);
  const champions: ChampRow[] = [...winCount.entries()]
    .map(([id, wins]) => ({ id, name: nameOf(id), wins }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

  // --- Trophy timeline + defence outcome per game ---
  // The reigning champion (winner of the previous completed game) "defends" in
  // the next game; they either defend (win again) or lose the title.
  const timeline: TimelineEntry[] = [];
  let prevWinner: string | undefined;
  for (const g of games) {
    let defence: TimelineEntry["defence"] = "none";
    if (g.winnerId) {
      if (!prevWinner) defence = "first";
      else if (g.winnerId === prevWinner) defence = "defended";
      else defence = "lost";
    }
    timeline.push({
      id: g.id,
      name: g.name,
      date: g.date,
      winnerId: g.winnerId,
      winnerName: nameOf(g.winnerId),
      hostId: g.hostId,
      hostName: nameOf(g.hostId),
      defence,
    });
    if (g.winnerId) prevWinner = g.winnerId;
  }
  // Newest first for display.
  timeline.reverse();

  // --- Droughts: gaps (in club games) between a player's wins ---
  const winIndexes = new Map<string, number[]>();
  games.forEach((g, i) => {
    if (g.winnerId) {
      const arr = winIndexes.get(g.winnerId) ?? [];
      arr.push(i);
      winIndexes.set(g.winnerId, arr);
    }
  });
  const droughts: DroughtRow[] = [];
  for (const [id, idxs] of winIndexes.entries()) {
    let longest = 0;
    for (let k = 1; k < idxs.length; k++) longest = Math.max(longest, idxs[k] - idxs[k - 1] - 1);
    const lastIdx = idxs[idxs.length - 1];
    const current = totalGames - 1 - lastIdx; // completed games since their last win
    droughts.push({
      id,
      name: nameOf(id),
      longest,
      current,
      lastWin: games[lastIdx]?.date ?? null,
    });
  }
  droughts.sort((a, b) => b.longest - a.longest || b.current - a.current);

  // --- Hosts leaderboard ---
  const hostCount = new Map<string, number>();
  for (const g of games) if (g.hostId) hostCount.set(g.hostId, (hostCount.get(g.hostId) ?? 0) + 1);
  const hosts: HostRow[] = [...hostCount.entries()]
    .map(([id, hosted]) => ({ id, name: nameOf(id), hosted }))
    .sort((a, b) => b.hosted - a.hosted || a.name.localeCompare(b.name));

  // --- Win streaks (longest back-to-back run per player) ---
  const bestStreak = new Map<string, number>();
  let runId: string | undefined;
  let runLen = 0;
  for (const g of games) {
    if (g.winnerId && g.winnerId === runId) {
      runLen += 1;
    } else if (g.winnerId) {
      runId = g.winnerId;
      runLen = 1;
    } else {
      runId = undefined;
      runLen = 0;
    }
    if (runId) bestStreak.set(runId, Math.max(bestStreak.get(runId) ?? 0, runLen));
  }
  const streaks: StreakRow[] = [...bestStreak.entries()]
    .map(([id, streak]) => ({ id, name: nameOf(id), streak }))
    .filter((s) => s.streak >= 2)
    .sort((a, b) => b.streak - a.streak || a.name.localeCompare(b.name));

  // --- First / last appearance (winner or host) ---
  const seen = new Map<string, { first: string; last: string }>();
  for (const g of games) {
    for (const id of [g.winnerId, g.hostId]) {
      if (!id) continue;
      const cur = seen.get(id);
      if (!cur) seen.set(id, { first: g.date, last: g.date });
      else {
        if (g.date < cur.first) cur.first = g.date;
        if (g.date > cur.last) cur.last = g.date;
      }
    }
  }
  const yearsBetween = (a: string, b: string) =>
    Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / (365.25 * 864e5)));
  const appearances: AppearanceRow[] = [...seen.entries()]
    .map(([id, v]) => ({ id, name: nameOf(id), first: v.first, last: v.last, span: yearsBetween(v.first, v.last) }))
    .sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));

  // --- Trophy defence attempts ---
  // A champion gets a defence "attempt" for every completed game that follows
  // one they won; the attempt succeeds if they also win that next game.
  const attempts = new Map<string, number>();
  const successes = new Map<string, number>();
  for (let i = 0; i < games.length - 1; i++) {
    const champ = games[i].winnerId;
    if (!champ) continue;
    attempts.set(champ, (attempts.get(champ) ?? 0) + 1);
    if (games[i + 1].winnerId === champ) successes.set(champ, (successes.get(champ) ?? 0) + 1);
  }
  const defences: DefenceRow[] = [...attempts.entries()]
    .map(([id, a]) => ({ id, name: nameOf(id), attempts: a, successes: successes.get(id) ?? 0 }))
    .sort((a, b) => b.successes - a.successes || b.attempts - a.attempts);

  return { totalGames, champions, timeline, droughts, hosts, streaks, appearances, defences };
}
