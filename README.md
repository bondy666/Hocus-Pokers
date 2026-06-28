# Hocus Pokers 🂡

A card-room–themed **members club stats tracker** for the *Hocus Pokers* poker club
of Horsham, West Sussex. It keeps tally of live-tournament stats — career
earnings/losses, wins, games played, venues and trophies — rather than playing
poker itself.

Built on the same stack as the club's sibling WhiskyClub site:
**Vite + React 19 + TypeScript**.

## Sections

1. **Hero** — club name, founding location (Horsham) and four headline stats
   (members, tournaments, prize pool, years running).
2. **Leaderboard** — career net P&L on a felt-green table, colour-coded green/red,
   with wins and games played. The table leader gets a gold highlight.
3. **Member Profiles** — a card per player: net P&L, wins, games, win rate and
   earned trophies/badges (e.g. *Christmas Win*, *Bluff of the Year*, *Most All-Ins*).
4. **Tournaments** — chronological list with live / upcoming / complete status
   badges, player count, venue, prize pool and winner attribution.
5. **The Card Room** — venue details (address, schedule, buy-in format) in a
   felt-green panel.
6. **House Rules** — six rules in a numbered grid with a left gold-border accent.

## Theme

Classic card room: deep felt green, warm gold and cream card stock — distinct
from the whisky site but built on the same "members club tracker" concept.

## Getting started

### Frontend only (zero backend)

```bash
npm install
npm run dev      # start the dev server (http://localhost:5173)
npm run build    # type-check + production build to dist/
npm run preview  # preview the production build
```

The frontend fetches from `/api/*` and **falls back to bundled seed data**
([`src/data.ts`](src/data.ts)) if the API isn't running, so it always renders.

### With the API (Express + mssql)

```bash
# terminal 1 — API (serves seed data until a database is configured)
cd server
npm install
cp .env.example .env   # then fill in SQL_CONNECTION_STRING for Azure SQL
npm run dev            # http://localhost:3000

# terminal 2 — frontend (Vite proxies /api → http://localhost:3000)
npm run dev
```

The API runs in **seed mode** when `SQL_CONNECTION_STRING` is unset, so you can
develop the full stack with no database. Set the connection string to switch to
Azure SQL automatically.

### Production (single server)

```bash
npm run build:all   # build frontend → dist/, install + build server
npm start           # server serves the API and the built frontend on :3000
```

The Express server serves the API under `/api/*` and the built SPA from `dist/`.

### Tests

Auth logic is unit-tested with [Vitest](https://vitest.dev/):

```bash
npm --prefix server test
```

## API

| Method | Route                            | Description                                          |
| ------ | -------------------------------- | ---------------------------------------------------- |
| GET    | `/api/health`                    | Liveness + active data source (`seed`/`azure-sql`)   |
| GET    | `/api/members`                   | All members with net P&L, wins, games, trophies      |
| GET    | `/api/leaderboard`               | Members sorted by career net P&L                     |
| GET    | `/api/tournaments`               | Tournaments, newest first, with status + winner      |
| GET    | `/api/me`                        | Current signed-in user (`401` if not signed in)      |
| POST   | `/api/members`                   | Create a member                                      |
| POST   | `/api/tournaments`               | Create a tournament                                  |
| POST   | `/api/tournaments/:id/results`   | Record a player's result (auto-sets winner if 1st)   |
| POST   | `/api/members/:id/trophies`      | Award a trophy to a member                           |

**Write endpoints require a signed-in user _and_ a database.** Every signed-in
member may save — there is no organiser-only restriction. They return `401`
when not signed in, and `503` in seed mode (no database).

## Authentication (Google / Microsoft sign-in)

Sign-in is handled by **Azure App Service "Easy Auth"** — no passwords or tokens
are handled by the app. Easy Auth runs the Google / Microsoft OAuth flow, then
forwards the signed-in user to the server in an `x-ms-client-principal` header,
which the API reads in [`server/src/index.ts`](server/src/index.ts). The pure,
testable auth logic (principal decoding, allow-list, access decisions) lives in
[`server/src/auth.ts`](server/src/auth.ts) and is covered by unit tests.

- **Login**: the UI links to `/.auth/login/google` and `/.auth/login/aad`.
- **Who am I**: the UI reads `/.auth/me` (production) or `/api/me` (fallback).
- **Logout**: `/.auth/logout`.
- **Microsoft** is configured with the `common` tenant, so both work/school and
  personal Microsoft (Outlook/Hotmail) accounts can sign in. **Google** covers
  any Gmail / Google account.
- **Access**: any signed-in member may save — every signed-in account has full
  access. `ADMIN_EMAILS` is retained for backwards compatibility but no longer
  restricts who can save.

### Local development

Easy Auth only exists in front of the deployed App Service. For local dev, set in
`server/.env`:

```env
ALLOW_DEV_AUTH=true
DEV_USER_EMAIL=organiser@hocuspokers.local
```

This makes the API treat requests as that signed-in user so you can exercise the
Score Keeper forms without the OAuth proxy.

### Score Keeper (admin UI)

The **Score Keeper** section provides forms to record a result, award a trophy and
add a tournament. When signed out it shows **Sign in with Google** / **Sign in with
Microsoft** buttons; when signed in it shows the account and a **Sign out** link,
and enables the forms. Requests are same-origin and authenticated by cookie.

## Infrastructure (Bicep)

[`azure/main.bicep`](azure/main.bicep) provisions everything in one deployment:
a Linux App Service plan + Node web app, an Azure SQL server + database, a
firewall rule for Azure services, the `SQL_CONNECTION_STRING` / `ADMIN_EMAILS`
app settings, **and Easy Auth (`authsettingsV2`) wired for Google and Microsoft**.

```bash
az group create -n rg-hocuspokers-prod -l uksouth
az deployment group create -g rg-hocuspokers-prod \
  -f azure/main.bicep \
  -p azure/main.parameters.json \
  -p sqlAdminPassword='<strong-password>' \
  -p googleClientId='<google-client-id>' \
  -p googleClientSecret='<google-client-secret>' \
  -p microsoftClientId='<entra-app-client-id>' \
  -p microsoftClientSecret='<entra-app-client-secret>' \
  -p adminEmails='organiser1@gmail.com,organiser2@outlook.com'
```

You provide the OAuth app credentials: create a **Google OAuth client** (Google
Cloud console) and a **Microsoft Entra app registration**, each with the redirect
URI `https://<your-web-app>/.auth/login/<provider>/callback`. Providers with an
empty client ID are simply left disabled.

To create the Microsoft Entra app registration automatically, run
[`azure/setup-auth.ps1`](azure/setup-auth.ps1) (requires `az login`):

```powershell
./azure/setup-auth.ps1 -AppName hocuspokers-web -SiteHostname hocuspokers-web.azurewebsites.net
```

It prints the `microsoftClientId` / `microsoftClientSecret` to pass to the Bicep
deployment. Google clients can't be created with the Azure CLI — set that one up
manually in the Google Cloud console.

Outputs include the web app URL and SQL FQDN. After deploying, run
[`sql/schema.sql`](sql/schema.sql) against the new database. The compiled ARM
template is committed alongside as `azure/main.json`.

## Deploying the app to Azure

A GitHub Actions workflow is included at
[`.github/workflows/azure-deploy.yml`](.github/workflows/azure-deploy.yml). On a
push to `main` it builds the frontend and server, prunes dev dependencies and
deploys to an Azure Web App.

**One-time setup**

1. Provision infrastructure with [`azure/main.bicep`](azure/main.bicep) (above),
   or create an Azure Web App (Linux, Node 22) and an Azure SQL database manually.
2. Run [`sql/schema.sql`](sql/schema.sql) against the database.
3. In the Web App **Configuration** (Bicep sets these for you):
   - App setting `SQL_CONNECTION_STRING` = your Azure SQL connection string.
   - App setting `ADMIN_EMAILS` = comma-separated organiser emails (optional allow-list).
   - **Authentication** = enable Google and Microsoft providers (Bicep configures this).
   - App setting `SCM_DO_BUILD_DURING_DEPLOYMENT` = `false` (artifact is prebuilt).
   - Startup Command = `npm start`.
4. Add an Azure federated credential and set the repo secrets
   `AZUREAPPSERVICE_CLIENTID`, `AZUREAPPSERVICE_TENANTID`,
   `AZUREAPPSERVICE_SUBSCRIPTIONID`.
5. Set `AZURE_WEBAPP_NAME` in the workflow `env` to your Web App name.

The deployed `package.json` `start` script runs `node server/dist/index.js`,
which serves the API and the built SPA from `dist/`.

## Data model

The seed data mirrors a trimmed database schema designed for an Azure SQL
backend — just four tables: `users`, `tournaments`, `tournament_results` and
`trophies`, plus a `vw_leaderboard` view that derives career P&L, wins and games
played. See [`sql/schema.sql`](sql/schema.sql).

### Next steps to make it a real backend app

- Stand up the schema on Azure SQL (`sql/schema.sql`).
- Set `SQL_CONNECTION_STRING` in `server/.env` — the API switches from seed data
  to Azure SQL automatically (no code change).
- Deploy to Azure App Service: run `npm run build:all`, then `npm start`.

## Project structure

```
HocusPokers/
├─ index.html
├─ vite.config.ts        # dev proxy: /api → localhost:3000
├─ src/
│  ├─ main.tsx           # React entry
│  ├─ App.tsx            # layout, nav, fetches data into ClubContext
│  ├─ api.ts             # API client (reads + writes) with seed fallback
│  ├─ ClubContext.ts     # React context for members + tournaments
│  ├─ data.ts            # seed data + derived stat helpers
│  ├─ index.css          # card-room theme
│  └─ sections/          # Hero, Leaderboard, Members, Tournaments, CardRoom, HouseRules, Admin
├─ public/favicon.svg
├─ server/               # Express + mssql API
│  ├─ src/
│  │  ├─ index.ts        # read + write routes, static SPA hosting
│  │  ├─ seed.ts         # fallback data when no DB configured
│  │  └─ db/sql.ts       # lazy Azure SQL connection pool
│  └─ .env.example
├─ .github/workflows/azure-deploy.yml   # CI build + Azure deploy
├─ azure/                # Bicep infra (App Service + Azure SQL) + compiled ARM
│  ├─ main.bicep
│  ├─ main.parameters.json
│  └─ main.json
└─ sql/schema.sql        # trimmed Azure SQL schema + seed
```
