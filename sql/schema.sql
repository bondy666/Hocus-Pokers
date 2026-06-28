-- Hocus Pokers — trimmed schema for the live-tournament stats tracker.
-- Target: Azure SQL Database (T-SQL). Scope: users, tournaments,
-- tournament_results, trophies. No poker engine — stats tracking only.

IF OBJECT_ID('dbo.tournament_results', 'U') IS NOT NULL DROP TABLE dbo.tournament_results;
IF OBJECT_ID('dbo.tournament_confirmations', 'U') IS NOT NULL DROP TABLE dbo.tournament_confirmations;
IF OBJECT_ID('dbo.tournament_photos', 'U') IS NOT NULL DROP TABLE dbo.tournament_photos;
IF OBJECT_ID('dbo.banter', 'U') IS NOT NULL DROP TABLE dbo.banter;
IF OBJECT_ID('dbo.trophies', 'U') IS NOT NULL DROP TABLE dbo.trophies;
IF OBJECT_ID('dbo.planning_votes', 'U') IS NOT NULL DROP TABLE dbo.planning_votes;
IF OBJECT_ID('dbo.planning_dates', 'U') IS NOT NULL DROP TABLE dbo.planning_dates;
IF OBJECT_ID('dbo.tournaments', 'U') IS NOT NULL DROP TABLE dbo.tournaments;
IF OBJECT_ID('dbo.users', 'U') IS NOT NULL DROP TABLE dbo.users;
GO

CREATE TABLE dbo.users (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    name          NVARCHAR(120) NOT NULL,
    nickname      NVARCHAR(60)  NULL,
    location      NVARCHAR(120) NULL,
    email         NVARCHAR(160) NULL,
    avatar        NVARCHAR(260) NULL,
    avatar_type   NVARCHAR(100) NULL,
    joined_year   INT           NOT NULL,
    created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.tournaments (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    name          NVARCHAR(160) NOT NULL,
    played_on     DATE          NOT NULL,
    venue         NVARCHAR(160) NOT NULL,
    address       NVARCHAR(260) NULL,
    players       INT           NOT NULL DEFAULT 0,
    buy_in        DECIMAL(10,2) NOT NULL DEFAULT 0,
    prize_pool    DECIMAL(10,2) NOT NULL DEFAULT 0,
    -- live | upcoming | complete
    status        NVARCHAR(20)  NOT NULL DEFAULT 'upcoming'
        CONSTRAINT CK_tournaments_status CHECK (status IN ('live','upcoming','complete')),
    winner_id     INT           NULL
        CONSTRAINT FK_tournaments_winner REFERENCES dbo.users(id)
);
GO

-- One row per player per tournament. Net is buy-in/rebuys netted against
-- cash-out, so a player's career P&L is SUM(net) across their results.
CREATE TABLE dbo.tournament_results (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    tournament_id  INT NOT NULL
        CONSTRAINT FK_results_tournament REFERENCES dbo.tournaments(id) ON DELETE CASCADE,
    user_id        INT NOT NULL
        CONSTRAINT FK_results_user REFERENCES dbo.users(id),
    finish_place   INT           NULL,
    buy_in_total   DECIMAL(10,2) NOT NULL DEFAULT 0,
    cash_out       DECIMAL(10,2) NOT NULL DEFAULT 0,
    net            AS (cash_out - buy_in_total) PERSISTED,
    CONSTRAINT UQ_results UNIQUE (tournament_id, user_id)
);
GO

-- Confirmed players for a tournament (the RSVP roster shown on each card).
-- One row per confirmed player per tournament.
CREATE TABLE dbo.tournament_confirmations (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    tournament_id  INT NOT NULL
        CONSTRAINT FK_confirmations_tournament REFERENCES dbo.tournaments(id) ON DELETE CASCADE,
    user_id        INT NOT NULL
        CONSTRAINT FK_confirmations_user REFERENCES dbo.users(id) ON DELETE CASCADE,
    created_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_confirmations UNIQUE (tournament_id, user_id)
);
GO

CREATE TABLE dbo.trophies (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    user_id     INT NOT NULL
        CONSTRAINT FK_trophies_user REFERENCES dbo.users(id) ON DELETE CASCADE,
    label       NVARCHAR(120) NOT NULL,
    emoji       NVARCHAR(16)  NULL,
    awarded_on  DATE          NULL,
    note        NVARCHAR(400) NULL
);
GO

-- Tournament-night planning: members propose candidate dates and vote for the
-- ones they can make. The server also creates these lazily if missing.
CREATE TABLE dbo.planning_dates (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    proposed_on DATE          NOT NULL,
    note        NVARCHAR(160) NULL,
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_planning_dates UNIQUE (proposed_on)
);
GO

CREATE TABLE dbo.planning_votes (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    date_id     INT NOT NULL
        CONSTRAINT FK_planning_votes_date REFERENCES dbo.planning_dates(id) ON DELETE CASCADE,
    voter_email NVARCHAR(160) NOT NULL,
    voter_name  NVARCHAR(160) NULL,
    created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_planning_votes UNIQUE (date_id, voter_email)
);
GO

-- Photos uploaded from tournament nights. Files live on the App Service
-- persistent volume; only metadata is stored here. Created lazily by the API.
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
GO

-- Club banter / shoutbox shown under the Card Room. Created lazily by the API.
CREATE TABLE dbo.banter (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    author_email NVARCHAR(160) NOT NULL,
    author_name  NVARCHAR(160) NULL,
    body         NVARCHAR(500) NOT NULL,
    created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

-- Leaderboard view: career net P&L, wins and games per player, counting only
-- "trophy games" — the first game of a night (earliest tournament id for that
-- date) that had 6+ registered (confirmed) members. Second/later games of a
-- night never affect the leaderboard.
CREATE OR ALTER VIEW dbo.vw_leaderboard AS
SELECT
    u.id,
    u.name,
    u.nickname,
    u.location,
    ISNULL(SUM(r.net), 0)                                AS net_pnl,
    COUNT(r.id)                                          AS games,
    -- Wins come from the recorded winner of each trophy game so the count
    -- includes historical games that have no per-result rows.
    (
        SELECT COUNT(*)
        FROM dbo.tournaments tw
        WHERE tw.winner_id = u.id
          AND tw.status = 'complete'
          AND tw.id = (
                SELECT MIN(t2.id)
                FROM dbo.tournaments t2
                WHERE t2.played_on = tw.played_on
            )
          AND (
                -- Registered headcount: confirmed roster if present, else the
                -- recorded headcount. Legacy games have no recorded count (0)
                -- and count as trophy games; a known small game (1-5) is excluded.
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM dbo.tournament_confirmations c
                        WHERE c.tournament_id = tw.id
                    )
                    THEN (
                        SELECT COUNT(*) FROM dbo.tournament_confirmations c
                        WHERE c.tournament_id = tw.id
                    )
                    ELSE tw.players
                END
            ) NOT BETWEEN 1 AND 5
    )                                                   AS wins
FROM dbo.users u
LEFT JOIN dbo.tournament_results r ON r.user_id = u.id
    AND r.tournament_id IN (
        SELECT t.id
        FROM dbo.tournaments t
        WHERE t.id = (
                SELECT MIN(t2.id)
                FROM dbo.tournaments t2
                WHERE t2.played_on = t.played_on
            )
          AND (
                -- "Registered members" = the confirmed roster when one exists
                -- (new game-night workflow); otherwise the recorded headcount.
                -- Legacy games (count 0) still count; a known small game (1-5)
                -- is excluded.
                CASE
                    WHEN EXISTS (
                        SELECT 1 FROM dbo.tournament_confirmations c
                        WHERE c.tournament_id = t.id
                    )
                    THEN (
                        SELECT COUNT(*) FROM dbo.tournament_confirmations c
                        WHERE c.tournament_id = t.id
                    )
                    ELSE t.players
                END
            ) NOT BETWEEN 1 AND 5
    )
GROUP BY u.id, u.name, u.nickname, u.location;
GO

-- Minimal seed so the API has something to serve.
INSERT INTO dbo.users (name, nickname, location, joined_year) VALUES
    (N'Marcus Rook',     N'The Rook', N'Horsham',        2017),
    (N'Priya Sharma',    N'Ice',      N'Crawley',        2018),
    (N'Hannah Ng',       N'Ace',      N'Cranleigh',      2021),
    (N'Ryan Collins',    N'Tilt',     N'Horsham',        2018);
GO

INSERT INTO dbo.tournaments (name, played_on, venue, players, buy_in, prize_pool, status, winner_id) VALUES
    (N'Spring Deepstack',      '2026-05-16', N'The Card Room, Horsham', 20, 40, 1000, 'complete', 3),
    (N'Summer Felt Classic',   '2026-06-13', N'The Card Room, Horsham', 18, 40, 900,  'live',     NULL),
    (N'Midsummer Bounty Brawl','2026-06-27', N'The Card Room, Horsham', 16, 40, 800,  'upcoming', NULL);
GO

INSERT INTO dbo.tournament_results (tournament_id, user_id, finish_place, buy_in_total, cash_out) VALUES
    (1, 3, 1, 40, 520),
    (1, 1, 2, 60, 300),
    (1, 2, 3, 40, 180),
    (1, 4, 8, 60, 0);
GO

INSERT INTO dbo.trophies (user_id, label, emoji, awarded_on) VALUES
    (1, N'Club Champion 2023', N'👑', '2023-12-15'),
    (2, N'Bluff of the Year',  N'🎭', '2025-11-08'),
    (3, N'Club Champion 2024', N'👑', '2024-12-20'),
    (4, N'Biggest Bad Beat',   N'💥', '2025-04-25');
GO
