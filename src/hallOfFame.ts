import type { Member, Tournament } from "./data.ts";

// All Hall of Fame analytics are derived from the completed-game record:
// each completed tournament has a date, an optional winner and an optional
// host. Money/attendance isn't tracked, so "appearances" are based on the
// games a player is recorded in (as winner or host).

export interface ChampRow {
  id: string;
  name: string;
  wins: number;
  rank: number; // 1-based; players tied on wins share the same rank
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

  // Only trophy games count towards the Hall of Fame: the first game of each
  // night (lowest id on that date) with at least 6 players. Second games and
  // small games (1-5 players) are excluded.
  const idNum = (id: string) => {
    const m = id.match(/\d+/g);
    return m ? Number(m.join("")) : 0;
  };
  const completed = tournaments.filter((t) => t.status === "complete");
  const firstByDate = new Map<string, Tournament>();
  for (const t of completed) {
    const cur = firstByDate.get(t.date);
    if (!cur || idNum(t.id) < idNum(cur.id)) firstByDate.set(t.date, t);
  }
  const trophyIds = new Set<string>();
  for (const t of firstByDate.values()) {
    // The headcount is the confirmed roster when one exists (the game-night
    // workflow); otherwise the recorded headcount. Legacy games predate rosters
    // (count 0) and are trusted as full trophy nights, so they always count.
    // A known small game (1-5 players) is excluded.
    const registered = t.confirmedPlayerIds?.length || t.players;
    if (registered === 0 || registered >= 6) trophyIds.add(t.id);
  }

  // Completed trophy games in chronological (oldest-first) order.
  const games = completed
    .filter((t) => trophyIds.has(t.id))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));

  const totalGames = games.length;

  // --- Champions (most wins) ---
  const winCount = new Map<string, number>();
  for (const g of games) if (g.winnerId) winCount.set(g.winnerId, (winCount.get(g.winnerId) ?? 0) + 1);
  const champions: ChampRow[] = [...winCount.entries()]
    .map(([id, wins]) => ({ id, name: nameOf(id), wins, rank: 0 }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  // Standard competition ranking: equal win counts share a rank, and the next
  // distinct total skips ahead (e.g. 1, 1, 3) so tied players get the same medal.
  let champRank = 0;
  let prevWins = Number.POSITIVE_INFINITY;
  champions.forEach((c, i) => {
    if (c.wins !== prevWins) {
      champRank = i + 1;
      prevWins = c.wins;
    }
    c.rank = champRank;
  });

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

  // --- Droughts: games without a win ---
  // A drought is the run of trophy nights without a win. We count a player's
  // wins from ALL completed games (not just trophy games), so a win in a second
  // or side game still breaks their drought. Players who have NEVER won belong
  // here too — they hold the longest droughts — so every member is listed,
  // counting the trophy games played since they joined as one unbroken drought.
  const winDates = new Map<string, string[]>();
  for (const g of completed) {
    if (!g.winnerId) continue;
    const arr = winDates.get(g.winnerId) ?? [];
    arr.push(g.date);
    winDates.set(g.winnerId, arr);
  }
  const nightDates = games.map((g) => g.date); // trophy nights, chronological
  const gamesAfter = (date: string) => nightDates.reduce((n, d) => (d > date ? n + 1 : n), 0);
  const gamesBetween = (lo: string, hi: string) =>
    nightDates.reduce((n, d) => (d > lo && d < hi ? n + 1 : n), 0);
  const gamesSinceJoin = (joined?: number) => {
    if (!joined) return totalGames;
    const floor = `${joined}-01-01`;
    return nightDates.reduce((n, d) => (d >= floor ? n + 1 : n), 0);
  };
  const droughts: DroughtRow[] = members.map((m) => {
    const dates = (winDates.get(m.id) ?? []).slice().sort();
    if (dates.length) {
      const last = dates[dates.length - 1];
      const current = gamesAfter(last); // trophy nights since their last win
      let longest = current;
      for (let k = 1; k < dates.length; k++) longest = Math.max(longest, gamesBetween(dates[k - 1], dates[k]));
      return { id: m.id, name: nameOf(m.id), longest, current, lastWin: last };
    }
    // Never won: every trophy game since they joined is one long drought.
    const since = gamesSinceJoin(m.joined);
    return { id: m.id, name: nameOf(m.id), longest: since, current: since, lastWin: null };
  });
  droughts.sort((a, b) => b.longest - a.longest || b.current - a.current || a.name.localeCompare(b.name));

  // --- Hosts leaderboard ---
  // A host hosts the *night*, so count one credit per distinct date they're
  // recorded against — across ALL completed games, not just trophy games.
  // (Otherwise a host set on the second game of a night, or on a sub-6 game,
  // would never appear.)
  const hostNights = new Map<string, Set<string>>();
  for (const g of completed) {
    if (!g.hostId) continue;
    const dates = hostNights.get(g.hostId) ?? new Set<string>();
    dates.add(g.date);
    hostNights.set(g.hostId, dates);
  }
  const hosts: HostRow[] = [...hostNights.entries()]
    .map(([id, dates]) => ({ id, name: nameOf(id), hosted: dates.size }))
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

  // --- First / last appearance (any game attended, won or hosted) ---
  // Attendance comes from each completed game's confirmed roster; winners and
  // hosts are folded in too so historical games (recorded before rosters were
  // tracked) still count their champion.
  const seen = new Map<string, { first: string; last: string }>();
  const noteAppearance = (id: string | undefined, date: string) => {
    if (!id) return;
    const cur = seen.get(id);
    if (!cur) seen.set(id, { first: date, last: date });
    else {
      if (date < cur.first) cur.first = date;
      if (date > cur.last) cur.last = date;
    }
  };
  for (const g of completed) {
    noteAppearance(g.winnerId, g.date);
    noteAppearance(g.hostId, g.date);
    for (const pid of g.confirmedPlayerIds ?? []) noteAppearance(pid, g.date);
  }
  const yearsBetween = (a: string, b: string) =>
    Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / (365.25 * 864e5)));
  // Rosters were only tracked on recent games, so a long-standing member's
  // first *recorded* game can be years after they really started. Floor the
  // first appearance by their join year (1 Jan of that year) so veterans aren't
  // shown as "first appearing" on their first recorded win/host.
  const joinedById = new Map(members.map((m) => [m.id, m.joined]));
  const appearances: AppearanceRow[] = [...seen.entries()]
    .map(([id, v]) => {
      const joined = joinedById.get(id);
      const joinFloor = joined ? `${joined}-01-01` : undefined;
      const first = joinFloor && joinFloor < v.first ? joinFloor : v.first;
      return { id, name: nameOf(id), first, last: v.last, span: yearsBetween(first, v.last) };
    })
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
