import {
  members as seedMembers,
  tournaments as seedTournaments,
  type Member,
  type Tournament,
} from "./data.ts";

// Base URL for the API. Empty string means "same origin" (production, where the
// Express server also serves the frontend). Override for local dev with a
// VITE_API_BASE env var, e.g. http://localhost:3000.
const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export interface ClubData {
  members: Member[];
  tournaments: Tournament[];
  source: "api" | "seed";
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

// PUT / DELETE helper. Body is optional (DELETE usually has none).
async function sendJson<T>(method: "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export interface ApiHealth {
  ok: boolean;
  source: "seed" | "azure-sql";
  writesEnabled?: boolean;
}

export const getHealth = () => getJson<ApiHealth>("/api/health");

export interface NewMember {
  name: string;
  nickname?: string;
  location?: string;
  email?: string;
  joined?: number;
  games?: number;
}

export const createMember = (body: NewMember) =>
  postJson<{ id: number }>("/api/members", body);

export const updateMember = (id: string, body: NewMember) =>
  sendJson<{ id: number }>("PUT", `/api/members/${id}`, body);

export const deleteMember = (id: string) =>
  sendJson<{ ok: boolean }>("DELETE", `/api/members/${id}`);

export async function uploadMemberAvatar(
  id: string,
  file: File
): Promise<{ ok: boolean; avatarUrl: string }> {
  const form = new FormData();
  form.append("avatar", file);
  const res = await fetch(`${API_BASE}/api/members/${id}/avatar`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return data as { ok: boolean; avatarUrl: string };
}

export interface NewTournament {
  name: string;
  date: string;
  venue: string;
  address?: string;
  players: number;
  buyIn: number;
  prizePool: number;
  status: "live" | "upcoming" | "complete";
  winnerId?: string;
  hostId?: string;
}

export const createTournament = (body: NewTournament) =>
  postJson<{ id: number }>("/api/tournaments", body);

// Clone a tournament into a new "game" on the same night, copying its roster.
export const cloneTournament = (id: string) =>
  postJson<{ id: number }>(`/api/tournaments/${id}/clone`, {});

export const updateTournament = (id: string, body: NewTournament) =>
  sendJson<{ id: number }>("PUT", `/api/tournaments/${id}`, body);

export const deleteTournament = (id: string) =>
  sendJson<{ ok: boolean }>("DELETE", `/api/tournaments/${id}`);

// ----- confirmed players (tournament roster) -----

export const confirmPlayer = (tournamentId: string, userId: string) =>
  postJson<{ ok: boolean }>(`/api/tournaments/${tournamentId}/confirmations`, {
    userId: Number(userId),
  });

export const unconfirmPlayer = (tournamentId: string, userId: string) =>
  sendJson<{ ok: boolean }>(
    "DELETE",
    `/api/tournaments/${tournamentId}/confirmations/${userId}`
  );

export interface NewResult {
  userId: number;
  finishPlace?: number;
  buyInTotal: number;
  cashOut: number;
}

export const recordResult = (tournamentId: string, body: NewResult) =>
  postJson<{ id: number; net: number }>(`/api/tournaments/${tournamentId}/results`, body);

export interface ResultRow {
  id: number;
  tournament_id: number;
  user_id: number;
  user_name: string;
  finish_place: number | null;
  buy_in_total: number;
  cash_out: number;
  net: number;
}

export const getResults = (tournamentId: string) =>
  getJson<ResultRow[]>(`/api/tournaments/${tournamentId}/results`);

export const updateResult = (
  id: number,
  body: { finishPlace?: number; buyInTotal: number; cashOut: number }
) => sendJson<ResultRow>("PUT", `/api/results/${id}`, body);

export const deleteResult = (id: number) =>
  sendJson<{ ok: boolean }>("DELETE", `/api/results/${id}`);

export interface NewTrophy {
  label: string;
  emoji?: string;
  awardedOn?: string;
  note?: string;
}

export const awardTrophy = (memberId: string, body: NewTrophy) =>
  postJson<{ id: number }>(`/api/members/${memberId}/trophies`, body);

export const updateTrophy = (id: string, body: NewTrophy) =>
  sendJson<{ id: number }>("PUT", `/api/trophies/${id}`, body);

export const deleteTrophy = (id: string) =>
  sendJson<{ ok: boolean }>("DELETE", `/api/trophies/${id}`);

// ----- tournament night planning (date poll) -----

export interface PlanningVoter {
  email: string;
  name: string;
}

export interface PlanningDate {
  id: number;
  date: string; // ISO yyyy-mm-dd
  note?: string;
  voteCount: number;
  voters: PlanningVoter[];
  votedByMe: boolean;
}

export const getPlanning = () => getJson<PlanningDate[]>("/api/planning");

export const proposeDate = (body: { date: string; note?: string }) =>
  postJson<PlanningDate>("/api/planning/dates", body);

export const voteDate = (id: number) =>
  postJson<{ id: number; voteCount: number; votedByMe: boolean }>(
    `/api/planning/dates/${id}/vote`,
    {}
  );

export const removeDate = (id: number) =>
  sendJson<{ ok: boolean }>("DELETE", `/api/planning/dates/${id}`);

export const setupFromDate = (id: number, body: { name: string; venue?: string }) =>
  postJson<{ id: number }>(`/api/planning/dates/${id}/setup`, body);

// ----- club statistics -----

export interface PlayerStat {
  id: string;
  name: string;
  nickname: string;
  net: number;
  games: number;
  wins: number;
  firsts: number;
  seconds: number;
  thirds: number;
  totalBuyIn: number;
  totalCashOut: number;
  bestFinish: number | null;
  itm: number; // in-the-money finishes
  avgFinish: number | null;
}

export interface PodiumGame {
  id: string;
  name: string;
  date: string;
  first: string | null;
  second: string | null;
  third: string | null;
}

export interface YearStanding {
  year: number;
  rows: { id: string; name: string; net: number; games: number; wins: number }[];
}

export interface TimelinePoint {
  x: number;
  y: number;
}

export interface TimelineSeries {
  id: string;
  name: string;
  points: TimelinePoint[];
}

export interface ClubStats {
  players: PlayerStat[];
  yearly: YearStanding[];
  podium: PodiumGame[];
  timeline: {
    tournaments: { id: string; name: string; date: string }[];
    series: TimelineSeries[];
  };
  totals: {
    totalBuyIn: number;
    totalCashOut: number;
    totalNet: number;
    tournaments: number;
    biggestWin: { name: string; amount: number } | null;
  };
}

export const getStats = () => getJson<ClubStats>("/api/stats");

// ----- tournament photos -----

export interface TournamentPhoto {
  id: number;
  tournamentId: number;
  url: string;
  caption?: string;
  uploadedBy?: string;
  uploadedAt?: string;
}

export const getPhotos = (tournamentId: string) =>
  getJson<TournamentPhoto[]>(`/api/tournaments/${tournamentId}/photos`);

export async function uploadPhotos(
  tournamentId: string,
  files: FileList | File[]
): Promise<TournamentPhoto[]> {
  const form = new FormData();
  for (const f of Array.from(files)) form.append("photos", f);
  const res = await fetch(`${API_BASE}/api/tournaments/${tournamentId}/photos`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `Upload failed (${res.status})`;
    throw new Error(msg);
  }
  return data as TournamentPhoto[];
}

export const deletePhoto = (id: number) =>
  sendJson<{ ok: boolean }>("DELETE", `/api/photos/${id}`);

// ----- club banter (shoutbox) -----

export interface BanterMessage {
  id: number;
  author: string;
  body: string;
  createdAt?: string;
  mine: boolean;
}

export const getBanter = () => getJson<BanterMessage[]>("/api/banter");

export const postBanter = (body: string) =>
  postJson<BanterMessage>("/api/banter", { body });

export const deleteBanter = (id: number) =>
  sendJson<{ ok: boolean }>("DELETE", `/api/banter/${id}`);

// ----- authentication (Azure App Service Easy Auth) -----

export interface CurrentUser {
  email: string;
  name: string;
  provider: string;
  canWrite: boolean;
}

export type AuthProvider = "google" | "aad";

const POST_LOGIN_REDIRECT = encodeURIComponent("/admin");

// Force an interactive account picker. Easy Auth forwards this query param to
// the IdP; for Google it prevents a silent `prompt=none` refresh, which would
// otherwise return `interaction_required` and surface as an HTTP 401.
const loginPrompt: Record<AuthProvider, string> = {
  google: "select_account",
  aad: "select_account",
};

export const loginUrl = (provider: AuthProvider): string =>
  `${API_BASE}/.auth/login/${provider}?prompt=${loginPrompt[provider]}&post_login_redirect_uri=${POST_LOGIN_REDIRECT}`;

export const logoutUrl = (): string =>
  `${API_BASE}/.auth/logout?post_logout_redirect_uri=${encodeURIComponent("/")}`;

type AuthClaim = { typ: string; val: string };

// Easy Auth /.auth/me has two shapes depending on the platform runtime version:
//  - v2 (~2): { clientPrincipal: { userDetails, identityProvider, claims } }
//  - v1 (~1): [ { user_id, provider_name, user_claims: [{ typ, val }] } ]
// This app's App Service runs runtimeVersion ~1, so we must handle both.
interface EasyAuthMeV2 {
  clientPrincipal?: {
    userDetails?: string;
    identityProvider?: string;
    userRoles?: string[];
    claims?: AuthClaim[];
  } | null;
}

interface EasyAuthMeV1Entry {
  user_id?: string;
  provider_name?: string;
  user_claims?: AuthClaim[];
}

const EMAIL_CLAIM =
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress";

function parseEasyAuthMe(
  data: EasyAuthMeV2 | EasyAuthMeV1Entry[],
): CurrentUser | null {
  // v1 legacy array shape
  if (Array.isArray(data)) {
    const entry = data[0];
    if (!entry) return null;
    const claim = (t: string) =>
      entry.user_claims?.find((c) => c.typ === t)?.val;
    const email = (claim(EMAIL_CLAIM) || entry.user_id || "").toLowerCase();
    if (!email) return null;
    return {
      email,
      name: claim("name") || email,
      provider: entry.provider_name || "unknown",
      canWrite: true,
    };
  }
  // v2 shape
  const p = data.clientPrincipal;
  if (p && p.userDetails) {
    const claim = (t: string) => p.claims?.find((c) => c.typ === t)?.val;
    return {
      email: (p.userDetails || "").toLowerCase(),
      name: claim("name") || p.userDetails || "",
      provider: p.identityProvider || "unknown",
      canWrite: true,
    };
  }
  return null;
}

// Resolve the signed-in user. Tries Easy Auth's /.auth/me (production) first,
// then falls back to the API's /api/me (covers local dev with ALLOW_DEV_AUTH).
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const res = await fetch(`${API_BASE}/.auth/me`, { credentials: "include" });
    if (res.ok) {
      const data = (await res.json()) as EasyAuthMeV2 | EasyAuthMeV1Entry[];
      const user = parseEasyAuthMe(data);
      if (user) return user;
    }
  } catch {
    // ignore — fall through to /api/me
  }

  try {
    const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
    if (res.ok) return (await res.json()) as CurrentUser;
  } catch {
    // not signed in
  }
  return null;
}

// Fetch from the API, falling back to bundled seed data if the API is
// unavailable so the site always renders.
export async function loadClubData(): Promise<ClubData> {
  try {
    const [members, tournaments] = await Promise.all([
      getJson<Member[]>("/api/members"),
      getJson<Tournament[]>("/api/tournaments"),
    ]);
    return { members, tournaments, source: "api" };
  } catch {
    return { members: seedMembers, tournaments: seedTournaments, source: "seed" };
  }
}

// ----- web push notifications -----

export interface PushConfig {
  key: string;
  enabled: boolean;
}

export const getPushConfig = () => getJson<PushConfig>("/api/push/public-key");

export const savePushSubscription = (subscription: PushSubscriptionJSON) =>
  postJson<{ ok: boolean }>("/api/push/subscribe", { subscription });

export const removePushSubscription = (endpoint: string) =>
  postJson<{ ok: boolean }>("/api/push/unsubscribe", { endpoint });

export const sendTestPush = (endpoint: string) =>
  postJson<{ ok: boolean }>("/api/push/test", { endpoint });
