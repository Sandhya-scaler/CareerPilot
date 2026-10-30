# 06 — Operations: run, configure, deploy

## Local development (macOS)
```bash
brew install postgresql@17 pgvector && brew services start postgresql@17
createdb careerpilot && createdb careerpilot_test
cp .env.example .env              # set SESSION_SECRET; ANTHROPIC_API_KEY optional
npm install
npm run seed                      # migrations + skill taxonomy (downloads the 35 MB embedding model once)
npm run dev:api                   # http://localhost:4000
npm run dev:web                   # http://localhost:3000
```
Homebrew gotcha seen on 2026-10-30: installing `pgvector` creates `share/postgresql@17` and `lib/postgresql@17` as real directories, which hides Postgres's own files, so `initdb` fails with "postgres.bki does not exist". The fix is to symlink the contents of `/opt/homebrew/share/postgresql/*` and `/opt/homebrew/lib/postgresql/*` into the `@17` directories, then run `initdb`.

## Checks
```bash
npm test                          # 81 API tests (needs careerpilot_test DB)
npm run eval -- --verbose         # extraction quality vs hand labels
npm run eval -- --llm             # same, with Claude (needs ANTHROPIC_API_KEY)
npm run typecheck
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run e2e   # API + web running
```

## Configuration (`.env`)
| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres with the `vector` extension available |
| `SESSION_SECRET` | yes in prod | 32+ random chars; the server refuses to boot in production otherwise |
| `ANTHROPIC_API_KEY` | no | Enables Claude extraction, plans, questions, rewording, grading |
| `CLAUDE_REASONING_MODEL` / `CLAUDE_EXTRACTION_MODEL` | no | Defaults `claude-opus-5-5` / `claude-haiku-5-5` |
| `EMBEDDINGS` | no | `local` (default) or `off` |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | no | Free key from developer.adzuna.com; adds India (`/in/`) aggregator search |
| `GITHUB_TOKEN` | no | Raises the GitHub API limit for imports (60 → 5,000 requests/h) |
| `WEB_ORIGIN` | no | CORS origin for direct API calls (SSE) |
| `APP_URL` | in prod | Public web URL, used for links in emails |
| `SMTP_URL` / `EMAIL_FROM` | no | e.g. `smtps://resend:API_KEY@smtp.resend.com:465`; enables opt-in Monday emails |
| `ADMIN_EMAILS` | no | Comma-separated; these accounts see `/admin` beta metrics |
| `PORT` | no | Honored by API and web (Render/Railway/Fly inject it) |
| `DISABLE_SCHEDULER` | no | `1` on instances that shouldn't run scheduled jobs (optional: jobs are already claimed once across instances) |
| `API_URL` (web, **build time**) | no | Where Next rewrites `/api` and `/auth`; default `http://localhost:4000` |

## Docker
```bash
brew install colima docker docker-compose && colima start --cpu 2 --memory 4   # no Docker Desktop needed
SESSION_SECRET=$(openssl rand -hex 32) docker compose up --build
# ports busy? API_HOST_PORT=4100 WEB_HOST_PORT=3100 docker compose up -d
```
Verified 2026-10-30: both images build, migrations and taxonomy seeding run on boot, and `npm run e2e` passes against the stack.

## Deploying on Render (blueprint included)
1. Push the repo to GitHub.
2. Render → **New → Blueprint** → select the repo. `render.yaml` creates `careerpilot-db` (Postgres 17), `careerpilot-api` and `careerpilot-web`.
3. When prompted:
   - **API:** `APP_URL` and `WEB_ORIGIN` = the web service URL (e.g. `https://careerpilot-web.onrender.com`), `ADMIN_EMAILS` = your email. Optionally set `ANTHROPIC_API_KEY`, `SMTP_URL`, `EMAIL_FROM` and the Adzuna keys.
   - **Web:** `API_URL` = the API service URL (e.g. `https://careerpilot-api.onrender.com`). It's used at build time.
4. Service URLs are only known after creation. If you guessed them wrong, fix them and redeploy the web service (its build bakes `API_URL`).
5. Open the web URL and create your account. `/admin` works for `ADMIN_EMAILS`.

The blueprint is written to Render's spec but hasn't been applied (needs your account). If Render rejects a field, the dashboard shows which.

## Deploying elsewhere
- **DB:** Neon or Supabase (both support pgvector). Run against an empty database; migrations apply on boot.
- **API:** Railway / Fly.io / Render from `apps/api/Dockerfile` (build context = repo root). Any number of instances: rate limits and scheduled jobs coordinate through Postgres. Mount a volume at `apps/api/.cache` so the embedding model isn't downloaded on every deploy.
- **Web:** Vercel (root `apps/web`) with `API_URL` set to the API's public URL at build time. Cookies then pass through the rewrite as first-party.
- Set `NODE_ENV=production` (secure cookies) and serve over HTTPS.

## Data sources and terms
Only official public job-board APIs and user-pasted text. Remotive is intentionally not used (no redistribution, and ≤4 calls/day). Show Adzuna attribution if you enable it. Never add scrapers for LinkedIn, Naukri or Indeed.

## Costs
Every Claude call is recorded in `llm_usage` (tokens and USD), visible per user at `/account`. Requirement extraction is cached by JD content hash, so a posting is only extracted once across all users.
