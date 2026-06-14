import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import webpush from "web-push";
import { getPool, sql, sqlConfigured } from "./db/sql";
import {
  parseEmailList,
  resolvePrincipal,
  evaluateWriteAccess,
  canWrite,
  type AuthOptions,
} from "./auth";
import {
  members as seedMembers,
  tournaments as seedTournaments,
  leaderboard as seedLeaderboard,
  type MemberDto,
  type TournamentDto,
} from "./seed";

const app = express();

const corsOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: corsOrigins, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));
app.use(express.json());

// Resolve the built frontend regardless of the working directory.
// Compiled file lives at server/dist/index.js, so the repo-root dist/ is two
// levels up; we also try cwd-relative paths for other launch layouts.
function resolveClientDist(): string {
  const candidates = [
    path.join(__dirname, "..", "..", "dist"),
    path.join(process.cwd(), "dist"),
    path.join(process.cwd(), "..", "dist"),
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, "index.html"))) ?? candidates[0];
}

const clientDistPath = resolveClientDist();
app.use(express.static(clientDistPath));

const usingDb = sqlConfigured;

// ----- photo uploads -----
//
// Tournament-night photos are stored on the App Service persistent volume
// (/home is durable on Linux App Service) with metadata kept in SQL. Override
// the base directory with UPLOAD_DIR if needed.
const uploadDir =
  process.env.UPLOAD_DIR ||
  (process.env.HOME ? path.join(process.env.HOME, "data", "uploads") : path.join(process.cwd(), "uploads"));

try {
  fs.mkdirSync(uploadDir, { recursive: true });
} catch (err) {
  console.error("Could not create upload directory", uploadDir, err);
}

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || "";
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    cb(null, ALLOWED_IMAGE_TYPES.has(file.mimetype));
  },
});

// ----- data access -----

// The original schema has no email column; add it lazily/idempotently so
// members can store the address they use to sign in.
let usersReady: Promise<void> | null = null;

function ensureUsersSchema(): Promise<void> {
  if (!usersReady) {
    usersReady = (async () => {
      const pool = await getPool();
      await pool.request().query(`
        IF COL_LENGTH('dbo.users', 'email') IS NULL
          ALTER TABLE dbo.users ADD email NVARCHAR(160) NULL;
      `);
      await pool.request().query(`
        IF COL_LENGTH('dbo.users', 'avatar') IS NULL
          ALTER TABLE dbo.users ADD avatar NVARCHAR(260) NULL;
      `);
      await pool.request().query(`
        IF COL_LENGTH('dbo.users', 'avatar_type') IS NULL
          ALTER TABLE dbo.users ADD avatar_type NVARCHAR(100) NULL;
      `);
    })().catch((err) => {
      usersReady = null;
      throw err;
    });
  }
  return usersReady;
}

// The original schema has no address column on tournaments; add it lazily so
// each tournament can carry its own venue address.
let tournamentsReady: Promise<void> | null = null;

function ensureTournamentsSchema(): Promise<void> {
  if (!tournamentsReady) {
    tournamentsReady = (async () => {
      const pool = await getPool();
      await pool.request().query(`
        IF COL_LENGTH('dbo.tournaments', 'address') IS NULL
          ALTER TABLE dbo.tournaments ADD address NVARCHAR(260) NULL;
      `);
      await pool.request().query(`
        IF COL_LENGTH('dbo.tournaments', 'host_id') IS NULL
          ALTER TABLE dbo.tournaments ADD host_id INT NULL;
      `);
    })().catch((err) => {
      tournamentsReady = null;
      throw err;
    });
  }
  return tournamentsReady;
}

async function loadMembers(): Promise<MemberDto[]> {
  if (!usingDb) return seedMembers;

  await ensureUsersSchema();
  const pool = await getPool();
  const board = await pool.request().query(`
    SELECT id, name, nickname, location, net_pnl, games, wins
    FROM dbo.vw_leaderboard
  `);
  const users = await pool.request().query(`
    SELECT id, joined_year, email, avatar, avatar_type FROM dbo.users
  `);
  const trophyRows = await pool.request().query(`
    SELECT id, user_id, label, emoji FROM dbo.trophies
  `);

  const joinedById = new Map<number, number>(
    users.recordset.map((u: any) => [u.id, u.joined_year])
  );
  const emailById = new Map<number, string>(
    users.recordset.map((u: any) => [u.id, u.email ?? ""])
  );
  const avatarById = new Map<number, string>(
    users.recordset.map((u: any) => [u.id, u.avatar ?? ""])
  );
  const trophiesByUser = new Map<number, { id: string; label: string; emoji: string }[]>();
  for (const t of trophyRows.recordset) {
    const list = trophiesByUser.get(t.user_id) ?? [];
    list.push({ id: String(t.id), label: t.label, emoji: t.emoji ?? "🏆" });
    trophiesByUser.set(t.user_id, list);
  }

  return board.recordset.map((r: any) => {
    const avatar = avatarById.get(r.id) ?? "";
    return {
      id: String(r.id),
      name: r.name,
      nickname: r.nickname ?? "",
      location: r.location ?? "",
      email: emailById.get(r.id) ?? "",
      // Cache-bust on the filename so a re-upload refreshes the image.
      avatarUrl: avatar ? `/api/members/${r.id}/avatar?v=${encodeURIComponent(avatar)}` : "",
      joined: joinedById.get(r.id) ?? 0,
      netPnl: Number(r.net_pnl ?? 0),
      wins: Number(r.wins ?? 0),
      games: Number(r.games ?? 0),
      trophies: trophiesByUser.get(r.id) ?? [],
    };
  });
}

async function loadTournaments(): Promise<TournamentDto[]> {
  if (!usingDb) return seedTournaments;

  await ensureTournamentsSchema();
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, name, played_on, venue, address, players, prize_pool, status, winner_id, host_id
    FROM dbo.tournaments
    ORDER BY played_on DESC
  `);

  return result.recordset.map((r: any) => ({
    id: String(r.id),
    name: r.name,
    date: new Date(r.played_on).toISOString().slice(0, 10),
    venue: r.venue,
    address: r.address ?? "",
    players: Number(r.players ?? 0),
    prizePool: Number(r.prize_pool ?? 0),
    status: r.status,
    winnerId: r.winner_id != null ? String(r.winner_id) : undefined,
    hostId: r.host_id != null ? String(r.host_id) : undefined,
  }));
}

// ----- routes -----

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    source: usingDb ? "azure-sql" : "seed",
    writesEnabled: usingDb,
  });
});

app.get("/api/members", async (_req, res) => {
  try {
    res.json(await loadMembers());
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load members", details: err.message });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    if (!usingDb) {
      res.json(seedLeaderboard());
      return;
    }
    const members = await loadMembers();
    res.json(
      [...members].sort(
        (a, b) => b.wins - a.wins || b.netPnl - a.netPnl || b.games - a.games
      )
    );
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load leaderboard", details: err.message });
  }
});

app.get("/api/tournaments", async (_req, res) => {
  try {
    res.json(await loadTournaments());
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load tournaments", details: err.message });
  }
});

// ----- authentication (Azure App Service Easy Auth) -----
//
// In production, App Service "Authentication" (Easy Auth) handles the Google /
// Microsoft OAuth flow and forwards a base64 'x-ms-client-principal' header to
// this server. We never see passwords or tokens — we just read the principal.
//
// For local development (no Easy Auth in front), set ALLOW_DEV_AUTH=true and
// optionally DEV_USER_EMAIL to simulate a signed-in user.

interface Principal {
  email: string;
  name: string;
  provider: string;
}

const authOptions: AuthOptions = {
  allowDevAuth: process.env.ALLOW_DEV_AUTH === "true",
  devUserEmail: process.env.DEV_USER_EMAIL || "dev@hocuspokers.local",
  adminEmails: parseEmailList(process.env.ADMIN_EMAILS),
};

function getPrincipal(req: express.Request): Principal | null {
  const header = req.headers["x-ms-client-principal"];
  return resolvePrincipal(typeof header === "string" ? header : undefined, authOptions);
}

// Gate a write behind a signed-in (and, if configured, allow-listed) user.
function requireUser(req: express.Request, res: express.Response): Principal | null {
  const header = req.headers["x-ms-client-principal"];
  const result = evaluateWriteAccess(typeof header === "string" ? header : undefined, authOptions);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return null;
  }
  return result.principal;
}

function requireDb(res: express.Response): boolean {
  if (!usingDb) {
    res.status(503).json({
      error: "Writes require a database",
      details: "Set SQL_CONNECTION_STRING to enable POST endpoints. The API is in seed mode.",
    });
    return false;
  }
  return true;
}

// Lighter gate than requireUser: any signed-in member (not just organisers on
// the admin allow-list) may use this. Used for the date-poll voting/proposing.
function requireSignedIn(req: express.Request, res: express.Response): Principal | null {
  const principal = getPrincipal(req);
  if (!principal || !principal.email) {
    res.status(401).json({ error: "Sign in to continue" });
    return null;
  }
  return principal;
}

// Current signed-in user (or 401). Used by the frontend to show auth state,
// especially in local dev where Easy Auth's /.auth/me is unavailable.
app.get("/api/me", (req, res) => {
  const principal = getPrincipal(req);
  if (!principal || !principal.email) {
    return res.status(401).json({ error: "Not signed in" });
  }
  res.json({ ...principal, canWrite: canWrite(principal, authOptions.adminEmails) });
});

// Create a member.
app.post("/api/members", async (req, res) => {
  if (!requireDb(res)) return;
  if (!requireSignedIn(req, res)) return;
  try {
    await ensureUsersSchema();
    const { name, nickname, location, email, joined } = req.body ?? {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "name is required" });
    }
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (cleanEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Name", sql.NVarChar(120), name)
      .input("Nickname", sql.NVarChar(60), nickname || null)
      .input("Location", sql.NVarChar(120), location || null)
      .input("Email", sql.NVarChar(160), cleanEmail || null)
      .input("JoinedYear", sql.Int, Number(joined) || new Date().getFullYear())
      .query(`
        INSERT INTO dbo.users (name, nickname, location, email, joined_year)
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.nickname, INSERTED.location, INSERTED.email, INSERTED.joined_year
        VALUES (@Name, @Nickname, @Location, @Email, @JoinedYear)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create member", details: err.message });
  }
});

// Create a tournament.
app.post("/api/tournaments", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const { name, date, venue, address, players, buyIn, prizePool, status, winnerId, hostId } = req.body ?? {};
    if (!name || !date || !venue) {
      return res.status(400).json({ error: "name, date and venue are required" });
    }
    const allowed = ["live", "upcoming", "complete"];
    const safeStatus = allowed.includes(status) ? status : "upcoming";
    await ensureTournamentsSchema();
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Name", sql.NVarChar(160), name)
      .input("PlayedOn", sql.Date, date)
      .input("Venue", sql.NVarChar(160), venue)
      .input("Address", sql.NVarChar(260), address ?? null)
      .input("Players", sql.Int, Number(players) || 0)
      .input("BuyIn", sql.Decimal(10, 2), Number(buyIn) || 0)
      .input("PrizePool", sql.Decimal(10, 2), Number(prizePool) || 0)
      .input("Status", sql.NVarChar(20), safeStatus)
      .input("WinnerId", sql.Int, winnerId != null && winnerId !== "" ? Number(winnerId) : null)
      .input("HostId", sql.Int, hostId != null && hostId !== "" ? Number(hostId) : null)
      .query(`
        INSERT INTO dbo.tournaments (name, played_on, venue, address, players, buy_in, prize_pool, status, winner_id, host_id)
        OUTPUT INSERTED.*
        VALUES (@Name, @PlayedOn, @Venue, @Address, @Players, @BuyIn, @PrizePool, @Status, @WinnerId, @HostId)
      `);
    res.status(201).json(result.recordset[0]);
    const created = result.recordset[0];
    void sendPush({
      title: "🃏 New tournament added",
      body: `${created.name} · ${created.venue}${
        created.played_on
          ? " · " + new Date(created.played_on).toLocaleDateString("en-GB")
          : ""
      }`,
      url: "/tournaments",
      tag: "tournament",
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create tournament", details: err.message });
  }
});

// Record a result for a player in a tournament.
app.post("/api/tournaments/:id/results", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const tournamentId = Number(req.params.id);
    const { userId, finishPlace, buyInTotal, cashOut } = req.body ?? {};
    if (!Number.isFinite(tournamentId) || !userId) {
      return res.status(400).json({ error: "valid tournament id and userId are required" });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("TournamentId", sql.Int, tournamentId)
      .input("UserId", sql.Int, Number(userId))
      .input("FinishPlace", sql.Int, finishPlace != null ? Number(finishPlace) : null)
      .input("BuyInTotal", sql.Decimal(10, 2), Number(buyInTotal) || 0)
      .input("CashOut", sql.Decimal(10, 2), Number(cashOut) || 0)
      .query(`
        INSERT INTO dbo.tournament_results (tournament_id, user_id, finish_place, buy_in_total, cash_out)
        OUTPUT INSERTED.id, INSERTED.tournament_id, INSERTED.user_id,
               INSERTED.finish_place, INSERTED.buy_in_total, INSERTED.cash_out, INSERTED.net
        VALUES (@TournamentId, @UserId, @FinishPlace, @BuyInTotal, @CashOut)
      `);

    // If this player won, mark them as the tournament winner.
    if (Number(finishPlace) === 1) {
      await pool
        .request()
        .input("TournamentId", sql.Int, tournamentId)
        .input("UserId", sql.Int, Number(userId))
        .query(`UPDATE dbo.tournaments SET winner_id = @UserId WHERE id = @TournamentId`);
    }

    res.status(201).json(result.recordset[0]);
  } catch (err: any) {
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ error: "Result already recorded for this player" });
    }
    res.status(500).json({ error: "Failed to record result", details: err.message });
  }
});

// Award a trophy to a player.
app.post("/api/members/:id/trophies", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const userId = Number(req.params.id);
    const { label, emoji, awardedOn, note } = req.body ?? {};
    if (!Number.isFinite(userId) || !label) {
      return res.status(400).json({ error: "valid member id and label are required" });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .input("Label", sql.NVarChar(120), label)
      .input("Emoji", sql.NVarChar(16), emoji || null)
      .input("AwardedOn", sql.Date, awardedOn || null)
      .input("Note", sql.NVarChar(400), note || null)
      .query(`
        INSERT INTO dbo.trophies (user_id, label, emoji, awarded_on, note)
        OUTPUT INSERTED.*
        VALUES (@UserId, @Label, @Emoji, @AwardedOn, @Note)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to award trophy", details: err.message });
  }
});

// List the recorded results for a tournament (with player names) so the admin
// UI can edit or delete individual entries.
app.get("/api/tournaments/:id/results", async (req, res) => {
  if (!usingDb) return res.json([]);
  try {
    const tournamentId = Number(req.params.id);
    if (!Number.isFinite(tournamentId)) {
      return res.status(400).json({ error: "valid tournament id is required" });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("TournamentId", sql.Int, tournamentId)
      .query(`
        SELECT r.id, r.tournament_id, r.user_id, u.name AS user_name,
               r.finish_place, r.buy_in_total, r.cash_out, r.net
        FROM dbo.tournament_results r
        JOIN dbo.users u ON u.id = r.user_id
        WHERE r.tournament_id = @TournamentId
        ORDER BY ISNULL(r.finish_place, 9999), r.id
      `);
    res.json(result.recordset);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load results", details: err.message });
  }
});

// Update a member.
app.put("/api/members/:id", async (req, res) => {
  if (!requireDb(res)) return;
  if (!requireSignedIn(req, res)) return;
  try {
    await ensureUsersSchema();
    const id = Number(req.params.id);
    const { name, nickname, location, email, joined } = req.body ?? {};
    if (!Number.isFinite(id) || !name) {
      return res.status(400).json({ error: "valid member id and name are required" });
    }
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (cleanEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: "Enter a valid email address" });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Name", sql.NVarChar(120), name)
      .input("Nickname", sql.NVarChar(60), nickname || null)
      .input("Location", sql.NVarChar(120), location || null)
      .input("Email", sql.NVarChar(160), cleanEmail || null)
      .input("JoinedYear", sql.Int, Number(joined) || new Date().getFullYear())
      .query(`
        UPDATE dbo.users
        SET name = @Name, nickname = @Nickname, location = @Location, email = @Email, joined_year = @JoinedYear
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.nickname, INSERTED.location, INSERTED.email, INSERTED.joined_year
        WHERE id = @Id
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }
    res.json(result.recordset[0]);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update member", details: err.message });
  }
});

// Delete a member. Blocked if they have recorded results (would lose history).
app.delete("/api/members/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "valid member id is required" });
    }
    const pool = await getPool();
    const used = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`SELECT COUNT(*) AS n FROM dbo.tournament_results WHERE user_id = @Id`);
    if (used.recordset[0].n > 0) {
      return res.status(409).json({
        error: "This member has recorded results. Delete their results first, or keep them for history.",
      });
    }
    // Clear any winner references, drop trophies (cascade) and the user.
    await pool.request().input("Id", sql.Int, id)
      .query(`UPDATE dbo.tournaments SET winner_id = NULL WHERE winner_id = @Id`);
    const del = await pool.request().input("Id", sql.Int, id)
      .query(`DELETE FROM dbo.users OUTPUT DELETED.id WHERE id = @Id`);
    if (del.recordset.length === 0) {
      return res.status(404).json({ error: "Member not found" });
    }
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete member", details: err.message });
  }
});

// Stream a member's avatar image (public read).
app.get("/api/members/:id/avatar", async (req, res) => {
  if (!usingDb) return res.status(404).end();
  try {
    await ensureUsersSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).end();
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`SELECT avatar, avatar_type FROM dbo.users WHERE id = @Id`);
    if (result.recordset.length === 0 || !result.recordset[0].avatar) {
      return res.status(404).end();
    }
    const row = result.recordset[0];
    const filePath = path.join(uploadDir, row.avatar);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    if (row.avatar_type) res.type(row.avatar_type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load avatar", details: err.message });
  }
});

// Upload (or replace) a member's avatar. Any signed-in member may do this.
app.post("/api/members/:id/avatar", (req, res) => {
  upload.single("avatar")(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg =
        uploadErr.code === "LIMIT_FILE_SIZE"
          ? "The image must be 12MB or smaller."
          : uploadErr.message || "Upload failed";
      return res.status(400).json({ error: msg });
    }
    if (!requireDb(res)) return;
    const principal = requireSignedIn(req, res);
    if (!principal) return;
    try {
      await ensureUsersSchema();
      const id = Number(req.params.id);
      const file = req.file as Express.Multer.File | undefined;
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "valid member id is required" });
      }
      if (!file) {
        return res.status(400).json({ error: "No image file was uploaded." });
      }
      const pool = await getPool();
      // Capture any previous avatar so we can delete the old file afterwards.
      const prev = await pool
        .request()
        .input("Id", sql.Int, id)
        .query(`SELECT avatar FROM dbo.users WHERE id = @Id`);
      if (prev.recordset.length === 0) {
        fs.promises.unlink(path.join(uploadDir, file.filename)).catch(() => {});
        return res.status(404).json({ error: "Member not found" });
      }
      await pool
        .request()
        .input("Id", sql.Int, id)
        .input("Avatar", sql.NVarChar(260), file.filename)
        .input("AvatarType", sql.NVarChar(100), file.mimetype || null)
        .query(`UPDATE dbo.users SET avatar = @Avatar, avatar_type = @AvatarType WHERE id = @Id`);
      const oldAvatar = prev.recordset[0].avatar;
      if (oldAvatar && oldAvatar !== file.filename) {
        fs.promises.unlink(path.join(uploadDir, oldAvatar)).catch(() => {});
      }
      res.status(201).json({
        ok: true,
        id,
        avatarUrl: `/api/members/${id}/avatar?v=${encodeURIComponent(file.filename)}`,
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to upload avatar", details: err.message });
    }
  });
});

// Update a tournament.
app.put("/api/tournaments/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const id = Number(req.params.id);
    const { name, date, venue, address, players, buyIn, prizePool, status, winnerId, hostId } = req.body ?? {};
    if (!Number.isFinite(id) || !name || !date || !venue) {
      return res.status(400).json({ error: "valid id, name, date and venue are required" });
    }
    const allowed = ["live", "upcoming", "complete"];
    const safeStatus = allowed.includes(status) ? status : "upcoming";
    await ensureTournamentsSchema();
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Name", sql.NVarChar(160), name)
      .input("PlayedOn", sql.Date, date)
      .input("Venue", sql.NVarChar(160), venue)
      .input("Address", sql.NVarChar(260), address ?? null)
      .input("Players", sql.Int, Number(players) || 0)
      .input("BuyIn", sql.Decimal(10, 2), Number(buyIn) || 0)
      .input("PrizePool", sql.Decimal(10, 2), Number(prizePool) || 0)
      .input("Status", sql.NVarChar(20), safeStatus)
      .input("WinnerId", sql.Int, winnerId != null && winnerId !== "" ? Number(winnerId) : null)
      .input("HostId", sql.Int, hostId != null && hostId !== "" ? Number(hostId) : null)
      .query(`
        UPDATE dbo.tournaments
        SET name = @Name, played_on = @PlayedOn, venue = @Venue, address = @Address, players = @Players,
            buy_in = @BuyIn, prize_pool = @PrizePool, status = @Status, winner_id = @WinnerId, host_id = @HostId
        OUTPUT INSERTED.*
        WHERE id = @Id
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }
    res.json(result.recordset[0]);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update tournament", details: err.message });
  }
});

// Delete a tournament (its results are removed via ON DELETE CASCADE).
app.delete("/api/tournaments/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "valid tournament id is required" });
    }
    const pool = await getPool();
    const del = await pool.request().input("Id", sql.Int, id)
      .query(`DELETE FROM dbo.tournaments OUTPUT DELETED.id WHERE id = @Id`);
    if (del.recordset.length === 0) {
      return res.status(404).json({ error: "Tournament not found" });
    }
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete tournament", details: err.message });
  }
});

// Update a recorded result.
app.put("/api/results/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const id = Number(req.params.id);
    const { finishPlace, buyInTotal, cashOut } = req.body ?? {};
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "valid result id is required" });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("FinishPlace", sql.Int, finishPlace != null && finishPlace !== "" ? Number(finishPlace) : null)
      .input("BuyInTotal", sql.Decimal(10, 2), Number(buyInTotal) || 0)
      .input("CashOut", sql.Decimal(10, 2), Number(cashOut) || 0)
      .query(`
        UPDATE dbo.tournament_results
        SET finish_place = @FinishPlace, buy_in_total = @BuyInTotal, cash_out = @CashOut
        OUTPUT INSERTED.id, INSERTED.tournament_id, INSERTED.user_id,
               INSERTED.finish_place, INSERTED.buy_in_total, INSERTED.cash_out, INSERTED.net
        WHERE id = @Id
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Result not found" });
    }
    const row = result.recordset[0];
    // Keep the tournament winner in sync with the 1st-place result.
    if (Number(finishPlace) === 1) {
      await pool.request()
        .input("TournamentId", sql.Int, row.tournament_id)
        .input("UserId", sql.Int, row.user_id)
        .query(`UPDATE dbo.tournaments SET winner_id = @UserId WHERE id = @TournamentId`);
    }
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update result", details: err.message });
  }
});

// Delete a recorded result.
app.delete("/api/results/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "valid result id is required" });
    }
    const pool = await getPool();
    const del = await pool.request().input("Id", sql.Int, id)
      .query(`
        DELETE FROM dbo.tournament_results
        OUTPUT DELETED.id, DELETED.tournament_id, DELETED.user_id, DELETED.finish_place
        WHERE id = @Id
      `);
    if (del.recordset.length === 0) {
      return res.status(404).json({ error: "Result not found" });
    }
    const row = del.recordset[0];
    // If we removed the winning result, clear the tournament winner.
    if (Number(row.finish_place) === 1) {
      await pool.request()
        .input("TournamentId", sql.Int, row.tournament_id)
        .input("UserId", sql.Int, row.user_id)
        .query(`UPDATE dbo.tournaments SET winner_id = NULL WHERE id = @TournamentId AND winner_id = @UserId`);
    }
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete result", details: err.message });
  }
});

// Update an awarded trophy.
app.put("/api/trophies/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const id = Number(req.params.id);
    const { label, emoji, awardedOn, note } = req.body ?? {};
    if (!Number.isFinite(id) || !label) {
      return res.status(400).json({ error: "valid trophy id and label are required" });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Label", sql.NVarChar(120), label)
      .input("Emoji", sql.NVarChar(16), emoji || null)
      .input("AwardedOn", sql.Date, awardedOn || null)
      .input("Note", sql.NVarChar(400), note || null)
      .query(`
        UPDATE dbo.trophies
        SET label = @Label, emoji = @Emoji, awarded_on = @AwardedOn, note = @Note
        OUTPUT INSERTED.*
        WHERE id = @Id
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: "Trophy not found" });
    }
    res.json(result.recordset[0]);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update trophy", details: err.message });
  }
});

// Delete an awarded trophy.
app.delete("/api/trophies/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "valid trophy id is required" });
    }
    const pool = await getPool();
    const del = await pool.request().input("Id", sql.Int, id)
      .query(`DELETE FROM dbo.trophies OUTPUT DELETED.id WHERE id = @Id`);
    if (del.recordset.length === 0) {
      return res.status(404).json({ error: "Trophy not found" });
    }
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete trophy", details: err.message });
  }
});

// ----- tournament photos -----

let photosReady: Promise<void> | null = null;

function ensurePhotosSchema(): Promise<void> {
  if (!photosReady) {
    photosReady = (async () => {
      const pool = await getPool();
      await pool.request().query(`
        IF OBJECT_ID('dbo.tournament_photos', 'U') IS NULL
        CREATE TABLE dbo.tournament_photos (
          id            INT IDENTITY(1,1) PRIMARY KEY,
          tournament_id INT NOT NULL
            CONSTRAINT FK_photos_tournament REFERENCES dbo.tournaments(id) ON DELETE CASCADE,
          filename      NVARCHAR(260) NOT NULL,
          original_name NVARCHAR(260) NULL,
          content_type  NVARCHAR(100) NULL,
          caption       NVARCHAR(280) NULL,
          uploaded_by   NVARCHAR(160) NULL,
          uploaded_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
        );
      `);
    })().catch((err) => {
      photosReady = null;
      throw err;
    });
  }
  return photosReady;
}

function photoDto(row: any) {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    url: `/api/photos/${row.id}/file`,
    caption: row.caption ?? undefined,
    uploadedBy: row.uploaded_by ?? undefined,
    uploadedAt: row.uploaded_at ? new Date(row.uploaded_at).toISOString() : undefined,
  };
}

// List photos for a tournament (public read).
app.get("/api/tournaments/:id/photos", async (req, res) => {
  if (!usingDb) return res.json([]);
  try {
    await ensurePhotosSchema();
    const tournamentId = Number(req.params.id);
    if (!Number.isFinite(tournamentId)) {
      return res.status(400).json({ error: "valid tournament id is required" });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("TournamentId", sql.Int, tournamentId)
      .query(`
        SELECT id, tournament_id, caption, uploaded_by, uploaded_at
        FROM dbo.tournament_photos
        WHERE tournament_id = @TournamentId
        ORDER BY uploaded_at DESC, id DESC
      `);
    res.json(result.recordset.map(photoDto));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load photos", details: err.message });
  }
});

// Stream a photo's binary (public read).
app.get("/api/photos/:id/file", async (req, res) => {
  if (!usingDb) return res.status(404).end();
  try {
    await ensurePhotosSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).end();
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`SELECT filename, content_type FROM dbo.tournament_photos WHERE id = @Id`);
    if (result.recordset.length === 0) return res.status(404).end();
    const row = result.recordset[0];
    const filePath = path.join(uploadDir, row.filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    if (row.content_type) res.type(row.content_type);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load photo", details: err.message });
  }
});

// Upload one or more photos to a tournament. Any signed-in member may add.
app.post("/api/tournaments/:id/photos", (req, res) => {
  upload.array("photos", 10)(req, res, async (uploadErr) => {
    if (uploadErr) {
      const msg =
        uploadErr.code === "LIMIT_FILE_SIZE"
          ? "Each photo must be 12MB or smaller."
          : uploadErr.message || "Upload failed";
      return res.status(400).json({ error: msg });
    }
    if (!requireDb(res)) return;
    const principal = requireSignedIn(req, res);
    if (!principal) return;
    try {
      await ensurePhotosSchema();
      const tournamentId = Number(req.params.id);
      const files = (req.files as Express.Multer.File[]) ?? [];
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ error: "valid tournament id is required" });
      }
      if (files.length === 0) {
        return res.status(400).json({ error: "No image files were uploaded." });
      }
      const pool = await getPool();
      const saved = [];
      for (const f of files) {
        const result = await pool
          .request()
          .input("TournamentId", sql.Int, tournamentId)
          .input("Filename", sql.NVarChar(260), f.filename)
          .input("OriginalName", sql.NVarChar(260), f.originalname?.slice(0, 260) || null)
          .input("ContentType", sql.NVarChar(100), f.mimetype || null)
          .input("UploadedBy", sql.NVarChar(160), principal.name || principal.email)
          .query(`
            INSERT INTO dbo.tournament_photos (tournament_id, filename, original_name, content_type, uploaded_by)
            OUTPUT INSERTED.id, INSERTED.tournament_id, INSERTED.caption, INSERTED.uploaded_by, INSERTED.uploaded_at
            VALUES (@TournamentId, @Filename, @OriginalName, @ContentType, @UploadedBy)
          `);
        saved.push(photoDto(result.recordset[0]));
      }
      res.status(201).json(saved);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save photos", details: err.message });
    }
  });
});

// Delete a photo (organiser only).
app.delete("/api/photos/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    await ensurePhotosSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "valid photo id is required" });
    }
    const pool = await getPool();
    const del = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`DELETE FROM dbo.tournament_photos OUTPUT DELETED.filename WHERE id = @Id`);
    if (del.recordset.length === 0) {
      return res.status(404).json({ error: "Photo not found" });
    }
    const filePath = path.join(uploadDir, del.recordset[0].filename);
    fs.promises.unlink(filePath).catch(() => {});
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete photo", details: err.message });
  }
});

// ----- club banter (shoutbox under the Card Room) -----
//
// Lazily-created chat board so members can leave banter between games.
// Public read; signed-in members may post; authors (or admins) may delete.

let banterReady: Promise<void> | null = null;

function ensureBanterSchema(): Promise<void> {
  if (!banterReady) {
    banterReady = (async () => {
      const pool = await getPool();
      await pool.request().query(`
        IF OBJECT_ID('dbo.banter', 'U') IS NULL
        CREATE TABLE dbo.banter (
          id           INT IDENTITY(1,1) PRIMARY KEY,
          author_email NVARCHAR(160) NOT NULL,
          author_name  NVARCHAR(160) NULL,
          body         NVARCHAR(500) NOT NULL,
          created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
        );
      `);
    })().catch((err) => {
      banterReady = null;
      throw err;
    });
  }
  return banterReady;
}

function banterDto(row: any, myEmail: string) {
  const email = String(row.author_email ?? "");
  return {
    id: row.id,
    author: row.author_name || email.split("@")[0] || "Anon",
    body: row.body,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    mine: !!myEmail && email.toLowerCase() === myEmail,
  };
}

// List recent banter (public read).
app.get("/api/banter", async (req, res) => {
  if (!usingDb) return res.json([]);
  try {
    await ensureBanterSchema();
    const myEmail = getPrincipal(req)?.email?.toLowerCase() ?? "";
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TOP 100 id, author_email, author_name, body, created_at
      FROM dbo.banter
      ORDER BY created_at DESC, id DESC
    `);
    // Return oldest-first so the newest sits at the bottom of the thread.
    res.json(result.recordset.map((r: any) => banterDto(r, myEmail)).reverse());
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load banter", details: err.message });
  }
});

// Post a message. Any signed-in member may do this.
app.post("/api/banter", async (req, res) => {
  if (!requireDb(res)) return;
  const principal = requireSignedIn(req, res);
  if (!principal) return;
  try {
    await ensureBanterSchema();
    const body = String(req.body?.body ?? "").trim();
    if (!body) return res.status(400).json({ error: "Message can't be empty" });
    if (body.length > 500) return res.status(400).json({ error: "Message is too long (max 500)" });
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Email", sql.NVarChar(160), principal.email)
      .input("Name", sql.NVarChar(160), principal.name || null)
      .input("Body", sql.NVarChar(500), body)
      .query(`
        INSERT INTO dbo.banter (author_email, author_name, body)
        OUTPUT INSERTED.id, INSERTED.author_email, INSERTED.author_name, INSERTED.body, INSERTED.created_at
        VALUES (@Email, @Name, @Body)
      `);
    res.status(201).json(banterDto(result.recordset[0], principal.email.toLowerCase()));
    const author = principal.name || principal.email.split("@")[0] || "A member";
    void sendPush({
      title: "💬 New banter at Hocus Pokers",
      body: `${author}: ${body.length > 120 ? body.slice(0, 117) + "…" : body}`,
      url: "/cardroom",
      tag: "banter",
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to post message", details: err.message });
  }
});

// Delete a message. The author may delete their own; admins may delete any.
app.delete("/api/banter/:id", async (req, res) => {
  if (!requireDb(res)) return;
  const principal = requireSignedIn(req, res);
  if (!principal) return;
  try {
    await ensureBanterSchema();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "valid message id is required" });
    }
    const pool = await getPool();
    const found = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`SELECT author_email FROM dbo.banter WHERE id = @Id`);
    if (found.recordset.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }
    const authorEmail = String(found.recordset[0].author_email ?? "").toLowerCase();
    const header = req.headers["x-ms-client-principal"];
    const isAdmin = evaluateWriteAccess(
      typeof header === "string" ? header : undefined,
      authOptions
    ).ok;
    if (authorEmail !== principal.email.toLowerCase() && !isAdmin) {
      return res.status(403).json({ error: "You can only delete your own messages" });
    }
    await pool.request().input("Id", sql.Int, id).query(`DELETE FROM dbo.banter WHERE id = @Id`);
    res.json({ ok: true, id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete message", details: err.message });
  }
});

// ----- tournament night planning (date poll) -----
//
// These tables aren't in the original schema, so we create them lazily and
// idempotently the first time a planning endpoint is hit. This avoids a
// separate migration step against the live database.

let planningReady: Promise<void> | null = null;

function ensurePlanningSchema(): Promise<void> {
  if (!planningReady) {
    planningReady = (async () => {
      const pool = await getPool();
      await pool.request().query(`
        IF OBJECT_ID('dbo.planning_dates', 'U') IS NULL
        CREATE TABLE dbo.planning_dates (
          id          INT IDENTITY(1,1) PRIMARY KEY,
          proposed_on DATE          NOT NULL,
          note        NVARCHAR(160) NULL,
          created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT UQ_planning_dates UNIQUE (proposed_on)
        );
        IF OBJECT_ID('dbo.planning_votes', 'U') IS NULL
        CREATE TABLE dbo.planning_votes (
          id          INT IDENTITY(1,1) PRIMARY KEY,
          date_id     INT NOT NULL
            CONSTRAINT FK_planning_votes_date REFERENCES dbo.planning_dates(id) ON DELETE CASCADE,
          voter_email NVARCHAR(160) NOT NULL,
          voter_name  NVARCHAR(160) NULL,
          created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT UQ_planning_votes UNIQUE (date_id, voter_email)
        );
      `);
    })().catch((err) => {
      planningReady = null;
      throw err;
    });
  }
  return planningReady;
}

// List proposed dates with vote counts and voters. Public read.
app.get("/api/planning", async (req, res) => {
  if (!usingDb) return res.json([]);
  try {
    await ensurePlanningSchema();
    const principal = getPrincipal(req);
    const myEmail = principal?.email?.toLowerCase() ?? "";
    const pool = await getPool();
    const datesResult = await pool.request().query(`
      SELECT id, proposed_on, note FROM dbo.planning_dates ORDER BY proposed_on
    `);
    const votesResult = await pool.request().query(`
      SELECT date_id, voter_email, voter_name FROM dbo.planning_votes
    `);
    const votesByDate = new Map<number, { email: string; name: string }[]>();
    for (const v of votesResult.recordset) {
      const list = votesByDate.get(v.date_id) ?? [];
      list.push({ email: v.voter_email, name: v.voter_name ?? "" });
      votesByDate.set(v.date_id, list);
    }
    const out = datesResult.recordset.map((d: any) => {
      const voters = votesByDate.get(d.id) ?? [];
      return {
        id: d.id,
        date: new Date(d.proposed_on).toISOString().slice(0, 10),
        note: d.note ?? undefined,
        voteCount: voters.length,
        voters,
        votedByMe: !!myEmail && voters.some((v) => v.email.toLowerCase() === myEmail),
      };
    });
    res.json(out);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load planner", details: err.message });
  }
});

// Propose a candidate date. Any signed-in member may do this.
app.post("/api/planning/dates", async (req, res) => {
  if (!requireDb(res)) return;
  const principal = requireSignedIn(req, res);
  if (!principal) return;
  try {
    await ensurePlanningSchema();
    const { date, note } = req.body ?? {};
    if (!date) return res.status(400).json({ error: "date is required" });
    const pool = await getPool();
    const result = await pool
      .request()
      .input("ProposedOn", sql.Date, date)
      .input("Note", sql.NVarChar(160), note || null)
      .query(`
        INSERT INTO dbo.planning_dates (proposed_on, note)
        OUTPUT INSERTED.id, INSERTED.proposed_on, INSERTED.note
        VALUES (@ProposedOn, @Note)
      `);
    const row = result.recordset[0];
    res.status(201).json({
      id: row.id,
      date: new Date(row.proposed_on).toISOString().slice(0, 10),
      note: row.note ?? undefined,
      voteCount: 0,
      voters: [],
      votedByMe: false,
    });
  } catch (err: any) {
    if (err.number === 2627 || err.number === 2601) {
      return res.status(409).json({ error: "That date is already proposed" });
    }
    res.status(500).json({ error: "Failed to propose date", details: err.message });
  }
});

// Toggle the current member's vote for a date.
app.post("/api/planning/dates/:id/vote", async (req, res) => {
  if (!requireDb(res)) return;
  const principal = requireSignedIn(req, res);
  if (!principal) return;
  try {
    await ensurePlanningSchema();
    const dateId = Number(req.params.id);
    if (!Number.isFinite(dateId)) {
      return res.status(400).json({ error: "valid date id is required" });
    }
    const email = principal.email.toLowerCase();
    const pool = await getPool();
    const existing = await pool
      .request()
      .input("DateId", sql.Int, dateId)
      .input("Email", sql.NVarChar(160), email)
      .query(`SELECT id FROM dbo.planning_votes WHERE date_id = @DateId AND voter_email = @Email`);

    let votedByMe: boolean;
    if (existing.recordset.length > 0) {
      await pool
        .request()
        .input("DateId", sql.Int, dateId)
        .input("Email", sql.NVarChar(160), email)
        .query(`DELETE FROM dbo.planning_votes WHERE date_id = @DateId AND voter_email = @Email`);
      votedByMe = false;
    } else {
      await pool
        .request()
        .input("DateId", sql.Int, dateId)
        .input("Email", sql.NVarChar(160), email)
        .input("Name", sql.NVarChar(160), principal.name || null)
        .query(`
          INSERT INTO dbo.planning_votes (date_id, voter_email, voter_name)
          VALUES (@DateId, @Email, @Name)
        `);
      votedByMe = true;
    }

    const count = await pool
      .request()
      .input("DateId", sql.Int, dateId)
      .query(`SELECT COUNT(*) AS n FROM dbo.planning_votes WHERE date_id = @DateId`);
    res.json({ id: dateId, voteCount: count.recordset[0].n, votedByMe });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to record vote", details: err.message });
  }
});

// Remove a proposed date (organiser only).
app.delete("/api/planning/dates/:id", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    await ensurePlanningSchema();
    const dateId = Number(req.params.id);
    if (!Number.isFinite(dateId)) {
      return res.status(400).json({ error: "valid date id is required" });
    }
    const pool = await getPool();
    const del = await pool
      .request()
      .input("Id", sql.Int, dateId)
      .query(`DELETE FROM dbo.planning_dates OUTPUT DELETED.id WHERE id = @Id`);
    if (del.recordset.length === 0) {
      return res.status(404).json({ error: "Date not found" });
    }
    res.json({ ok: true, id: dateId });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to remove date", details: err.message });
  }
});

// Turn a proposed date into a real (upcoming) tournament (organiser only).
// The voters become the agreed player count.
app.post("/api/planning/dates/:id/setup", async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireDb(res)) return;
  try {
    await ensurePlanningSchema();
    const dateId = Number(req.params.id);
    const { name, venue } = req.body ?? {};
    if (!Number.isFinite(dateId) || !name) {
      return res.status(400).json({ error: "valid date id and name are required" });
    }
    const pool = await getPool();
    const dateRow = await pool
      .request()
      .input("Id", sql.Int, dateId)
      .query(`SELECT proposed_on FROM dbo.planning_dates WHERE id = @Id`);
    if (dateRow.recordset.length === 0) {
      return res.status(404).json({ error: "Date not found" });
    }
    const playedOn = new Date(dateRow.recordset[0].proposed_on).toISOString().slice(0, 10);
    const votes = await pool
      .request()
      .input("DateId", sql.Int, dateId)
      .query(`SELECT COUNT(*) AS n FROM dbo.planning_votes WHERE date_id = @DateId`);
    const players = votes.recordset[0].n;

    const created = await pool
      .request()
      .input("Name", sql.NVarChar(160), name)
      .input("PlayedOn", sql.Date, playedOn)
      .input("Venue", sql.NVarChar(160), venue || "The Card Room, Ealing")
      .input("Players", sql.Int, players)
      .query(`
        INSERT INTO dbo.tournaments (name, played_on, venue, players, buy_in, prize_pool, status)
        OUTPUT INSERTED.id
        VALUES (@Name, @PlayedOn, @Venue, @Players, 0, 0, 'upcoming')
      `);

    // Clear the proposed date now it's locked in.
    await pool.request().input("Id", sql.Int, dateId)
      .query(`DELETE FROM dbo.planning_dates WHERE id = @Id`);

    res.status(201).json({ id: created.recordset[0].id });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to set up tournament", details: err.message });
  }
});

// ----- club statistics -----

interface ResultJoinRow {
  tournament_id: number;
  t_name: string;
  played_on: Date;
  status: string;
  user_id: number;
  user_name: string;
  nickname: string | null;
  finish_place: number | null;
  buy_in_total: number;
  cash_out: number;
  net: number;
}

function buildStats(rows: ResultJoinRow[]) {
  // Per-player aggregates.
  const playerMap = new Map<number, any>();
  for (const r of rows) {
    let p = playerMap.get(r.user_id);
    if (!p) {
      p = {
        id: String(r.user_id),
        name: r.user_name,
        nickname: r.nickname ?? "",
        net: 0,
        games: 0,
        wins: 0,
        firsts: 0,
        seconds: 0,
        thirds: 0,
        totalBuyIn: 0,
        totalCashOut: 0,
        bestFinish: null as number | null,
        itm: 0,
        _finishSum: 0,
        _finishCount: 0,
      };
      playerMap.set(r.user_id, p);
    }
    p.net += Number(r.net);
    p.games += 1;
    if (Number(r.finish_place) === 1) {
      p.wins += 1;
      p.firsts += 1;
    } else if (Number(r.finish_place) === 2) {
      p.seconds += 1;
    } else if (Number(r.finish_place) === 3) {
      p.thirds += 1;
    }
    p.totalBuyIn += Number(r.buy_in_total);
    p.totalCashOut += Number(r.cash_out);
    if (Number(r.cash_out) > 0) p.itm += 1;
    if (r.finish_place != null) {
      p.bestFinish = p.bestFinish == null ? r.finish_place : Math.min(p.bestFinish, r.finish_place);
      p._finishSum += Number(r.finish_place);
      p._finishCount += 1;
    }
  }
  const players = [...playerMap.values()].map((p) => ({
    id: p.id,
    name: p.name,
    nickname: p.nickname,
    net: p.net,
    games: p.games,
    wins: p.wins,
    firsts: p.firsts,
    seconds: p.seconds,
    thirds: p.thirds,
    totalBuyIn: p.totalBuyIn,
    totalCashOut: p.totalCashOut,
    bestFinish: p.bestFinish,
    itm: p.itm,
    avgFinish: p._finishCount > 0 ? p._finishSum / p._finishCount : null,
  }));

  // Timeline: cumulative net per player across tournaments in date order.
  const tournamentOrder: { id: number; name: string; date: string }[] = [];
  const seenT = new Set<number>();
  for (const r of rows) {
    if (!seenT.has(r.tournament_id)) {
      seenT.add(r.tournament_id);
      tournamentOrder.push({
        id: r.tournament_id,
        name: r.t_name,
        date: new Date(r.played_on).toISOString().slice(0, 10),
      });
    }
  }
  tournamentOrder.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const indexById = new Map(tournamentOrder.map((t, i) => [t.id, i]));

  // net per (player, tournamentIndex)
  const netByPlayerTourn = new Map<number, Map<number, number>>();
  for (const r of rows) {
    const ti = indexById.get(r.tournament_id)!;
    let m = netByPlayerTourn.get(r.user_id);
    if (!m) {
      m = new Map();
      netByPlayerTourn.set(r.user_id, m);
    }
    m.set(ti, (m.get(ti) ?? 0) + Number(r.net));
  }
  const series = [...playerMap.values()].map((p) => {
    const m = netByPlayerTourn.get(Number(p.id)) ?? new Map<number, number>();
    let cum = 0;
    const points = tournamentOrder.map((_, i) => {
      cum += m.get(i) ?? 0;
      return { x: i, y: cum };
    });
    return { id: p.id, name: p.name, points };
  });

  // Yearly standings.
  const yearMap = new Map<number, Map<number, { name: string; net: number; games: number; wins: number }>>();
  for (const r of rows) {
    const yr = new Date(r.played_on).getFullYear();
    if (!yearMap.has(yr)) yearMap.set(yr, new Map());
    const ym = yearMap.get(yr)!;
    const cur = ym.get(r.user_id) ?? { name: r.user_name, net: 0, games: 0, wins: 0 };
    cur.net += Number(r.net);
    cur.games += 1;
    if (Number(r.finish_place) === 1) cur.wins += 1;
    ym.set(r.user_id, cur);
  }
  const yearly = [...yearMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, ym]) => ({
      year,
      rows: [...ym.entries()]
        .map(([id, v]) => ({ id: String(id), name: v.name, net: v.net, games: v.games, wins: v.wins }))
        .sort((a, b) => b.net - a.net),
    }));

  const totalBuyIn = players.reduce((s, p) => s + p.totalBuyIn, 0);
  const totalCashOut = players.reduce((s, p) => s + p.totalCashOut, 0);
  let biggestWin: { name: string; amount: number } | null = null;
  for (const r of rows) {
    if (!biggestWin || Number(r.net) > biggestWin.amount) {
      biggestWin = { name: r.user_name, amount: Number(r.net) };
    }
  }

  // Podium per tournament: the 1st / 2nd / 3rd place finishers (each optional).
  const podiumByT = new Map<
    number,
    { id: number; name: string; date: string; first?: string; second?: string; third?: string }
  >();
  for (const r of rows) {
    let row = podiumByT.get(r.tournament_id);
    if (!row) {
      row = {
        id: r.tournament_id,
        name: r.t_name,
        date: new Date(r.played_on).toISOString().slice(0, 10),
      };
      podiumByT.set(r.tournament_id, row);
    }
    if (Number(r.finish_place) === 1) row.first = r.user_name;
    else if (Number(r.finish_place) === 2) row.second = r.user_name;
    else if (Number(r.finish_place) === 3) row.third = r.user_name;
  }
  const podium = [...podiumByT.values()]
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : b.id - a.id))
    .map((p) => ({
      id: String(p.id),
      name: p.name,
      date: p.date,
      first: p.first ?? null,
      second: p.second ?? null,
      third: p.third ?? null,
    }));

  return {
    players,
    yearly,
    podium,
    timeline: {
      tournaments: tournamentOrder.map((t) => ({ id: String(t.id), name: t.name, date: t.date })),
      series,
    },
    totals: {
      totalBuyIn,
      totalCashOut,
      totalNet: totalCashOut - totalBuyIn,
      tournaments: tournamentOrder.length,
      biggestWin,
    },
  };
}

app.get("/api/stats", async (_req, res) => {
  try {
    if (!usingDb) {
      return res.json(seedStats());
    }
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT r.tournament_id, t.name AS t_name, t.played_on, t.status,
             r.user_id, u.name AS user_name, u.nickname,
             r.finish_place, r.buy_in_total, r.cash_out, r.net
      FROM dbo.tournament_results r
      JOIN dbo.tournaments t ON t.id = r.tournament_id
      JOIN dbo.users u ON u.id = r.user_id
      ORDER BY t.played_on, t.id
    `);
    res.json(buildStats(result.recordset as ResultJoinRow[]));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to load stats", details: err.message });
  }
});

// Approximate stats from the bundled seed arrays (no per-result data), so the
// page renders in seed mode.
function seedStats() {
  const completed = seedTournaments
    .filter((t) => t.status === "complete")
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const n = Math.max(completed.length, 1);

  const players = seedMembers.map((m) => {
    const totalBuyIn = m.games * 45;
    return {
      id: m.id,
      name: m.name,
      nickname: m.nickname,
      net: m.netPnl,
      games: m.games,
      wins: m.wins,
      firsts: m.wins,
      seconds: 0,
      thirds: 0,
      totalBuyIn,
      totalCashOut: totalBuyIn + m.netPnl,
      bestFinish: m.wins > 0 ? 1 : null,
      itm: Math.min(m.games, m.wins + Math.round(m.games * 0.25)),
      avgFinish: null,
    };
  });

  const series = seedMembers.map((m) => ({
    id: m.id,
    name: m.name,
    points: completed.map((_, i) => ({ x: i, y: Math.round((m.netPnl * (i + 1)) / n) })),
  }));

  const yearMap = new Map<number, Map<string, { name: string; net: number; wins: number }>>();
  for (const t of completed) {
    const yr = new Date(t.date).getFullYear();
    const w = seedMembers.find((m) => m.id === t.winnerId);
    if (!w) continue;
    if (!yearMap.has(yr)) yearMap.set(yr, new Map());
    const ym = yearMap.get(yr)!;
    const cur = ym.get(w.id) ?? { name: w.name, net: 0, wins: 0 };
    cur.net += t.prizePool;
    cur.wins += 1;
    ym.set(w.id, cur);
  }
  const yearly = [...yearMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, ym]) => ({
      year,
      rows: [...ym.entries()]
        .map(([id, v]) => ({ id, name: v.name, net: v.net, games: 0, wins: v.wins }))
        .sort((a, b) => b.net - a.net),
    }));

  const totalBuyIn = players.reduce((s, p) => s + p.totalBuyIn, 0);
  const totalCashOut = players.reduce((s, p) => s + p.totalCashOut, 0);
  const best = [...seedMembers].sort((a, b) => b.netPnl - a.netPnl)[0];

  const podium = completed
    .slice()
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .map((t) => {
      const w = seedMembers.find((m) => m.id === t.winnerId);
      return {
        id: t.id,
        name: t.name,
        date: t.date,
        first: w ? w.name : null,
        second: null,
        third: null,
      };
    });

  return {
    players,
    yearly,
    podium,
    timeline: {
      tournaments: completed.map((t) => ({ id: t.id, name: t.name, date: t.date })),
      series,
    },
    totals: {
      totalBuyIn,
      totalCashOut,
      totalNet: totalCashOut - totalBuyIn,
      tournaments: seedTournaments.length,
      biggestWin: best ? { name: best.name, amount: best.netPnl } : null,
    },
  };
}

// ----- web push notifications -----
//
// Members can opt in to phone notifications (PWA Web Push). We persist each
// device's push subscription in a lazily-created table and fan out a payload
// whenever there's new banter or a new tournament. VAPID keys come from env;
// if unset, push is disabled gracefully (endpoints still respond).

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:club@hocuspokers.local";
const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey);

if (pushEnabled) {
  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  } catch (err) {
    console.error("Invalid VAPID configuration; push disabled", err);
  }
}

let pushReady: Promise<void> | null = null;

function ensurePushSchema(): Promise<void> {
  if (!pushReady) {
    pushReady = (async () => {
      const pool = await getPool();
      await pool.request().query(`
        IF OBJECT_ID('dbo.push_subscriptions', 'U') IS NULL
        CREATE TABLE dbo.push_subscriptions (
          id          INT IDENTITY(1,1) PRIMARY KEY,
          endpoint    NVARCHAR(500) NOT NULL,
          p256dh      NVARCHAR(300) NOT NULL,
          auth        NVARCHAR(300) NOT NULL,
          email       NVARCHAR(160) NULL,
          created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT UQ_push_subscriptions_endpoint UNIQUE (endpoint)
        );
      `);
    })().catch((err) => {
      pushReady = null;
      throw err;
    });
  }
  return pushReady;
}

// Fan a notification out to every stored subscription. Best-effort: stale
// endpoints (404/410) are pruned. Never throws to its caller.
async function sendPush(payload: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}): Promise<void> {
  if (!pushEnabled || !usingDb) return;
  try {
    await ensurePushSchema();
    const pool = await getPool();
    const subs = await pool
      .request()
      .query(`SELECT id, endpoint, p256dh, auth FROM dbo.push_subscriptions`);
    if (subs.recordset.length === 0) return;
    const data = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || "/",
      tag: payload.tag,
    });
    const stale: number[] = [];
    await Promise.all(
      subs.recordset.map(async (row: any) => {
        const subscription = {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };
        try {
          await webpush.sendNotification(subscription, data);
        } catch (err: any) {
          const code = err?.statusCode;
          if (code === 404 || code === 410) stale.push(row.id);
        }
      })
    );
    if (stale.length > 0) {
      await pool
        .request()
        .query(`DELETE FROM dbo.push_subscriptions WHERE id IN (${stale.join(",")})`);
    }
  } catch (err) {
    console.error("sendPush failed", err);
  }
}

// Expose the VAPID public key so the browser can build a subscription.
app.get("/api/push/public-key", (_req, res) => {
  res.json({ key: pushEnabled ? vapidPublicKey : "", enabled: pushEnabled });
});

// Store (or refresh) a device's push subscription. Any visitor may subscribe.
app.post("/api/push/subscribe", async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: "Push is not configured" });
  if (!requireDb(res)) return;
  try {
    const sub = req.body?.subscription ?? req.body;
    const endpoint = String(sub?.endpoint ?? "");
    const p256dh = String(sub?.keys?.p256dh ?? "");
    const auth = String(sub?.keys?.auth ?? "");
    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ error: "A valid push subscription is required" });
    }
    const email = getPrincipal(req)?.email?.toLowerCase() ?? null;
    await ensurePushSchema();
    const pool = await getPool();
    await pool
      .request()
      .input("Endpoint", sql.NVarChar(500), endpoint)
      .input("P256dh", sql.NVarChar(300), p256dh)
      .input("Auth", sql.NVarChar(300), auth)
      .input("Email", sql.NVarChar(160), email)
      .query(`
        MERGE dbo.push_subscriptions AS target
        USING (SELECT @Endpoint AS endpoint) AS src
          ON target.endpoint = src.endpoint
        WHEN MATCHED THEN
          UPDATE SET p256dh = @P256dh, auth = @Auth, email = @Email
        WHEN NOT MATCHED THEN
          INSERT (endpoint, p256dh, auth, email)
          VALUES (@Endpoint, @P256dh, @Auth, @Email);
      `);
    res.status(201).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save subscription", details: err.message });
  }
});

// Remove a device's subscription (when the user turns notifications off).
app.post("/api/push/unsubscribe", async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const endpoint = String(req.body?.endpoint ?? req.body?.subscription?.endpoint ?? "");
    if (!endpoint) return res.status(400).json({ error: "endpoint is required" });
    await ensurePushSchema();
    const pool = await getPool();
    await pool
      .request()
      .input("Endpoint", sql.NVarChar(500), endpoint)
      .query(`DELETE FROM dbo.push_subscriptions WHERE endpoint = @Endpoint`);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to remove subscription", details: err.message });
  }
});

// SPA fallback for client-side routes.
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});
const port = process.env.PORT || 3000;

// Touch the sql import so the type is retained even without a DB configured.
void sql;

app.listen(port, () => {
  console.log(
    `Hocus Pokers API listening on :${port} (data source: ${usingDb ? "Azure SQL" : "seed"})`
  );
});
