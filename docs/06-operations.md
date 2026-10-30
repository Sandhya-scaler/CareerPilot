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
| `API_URL` (web, **build time**) | no | Where Next rewrites `/api` and `/auth`; default `http://localhost:4000` |

## Docker
```bash
SESSION_SECRET=$(openssl rand -hex 32) docker compose up --build
```
Written but **not yet built on this machine** (Docker isn't installed). The first build is the thing to verify.

## Deploying (suggested)
- **DB:** Neon or Supabase (both support pgvector). Run against an empty database; migrations apply on boot.
- **API:** Railway / Fly.io / Render from `apps/api/Dockerfile` (build context = repo root). One instance: the scheduler and rate limiter are in-process. Mount a volume at `apps/api/.cache` so the embedding model isn't downloaded on every deploy.
- **Web:** Vercel (root `apps/web`) with `API_URL` set to the API's public URL at build time. Cookies then pass through the rewrite as first-party.
- Set `NODE_ENV=production` (secure cookies) and serve over HTTPS.

## Data sources and terms
Only official public job-board APIs and user-pasted text. Remotive is intentionally not used (no redistribution, and ≤4 calls/day). Show Adzuna attribution if you enable it. Never add scrapers for LinkedIn, Naukri or Indeed.

## Costs
Every Claude call is recorded in `llm_usage` (tokens and USD), visible per user at `/account`. Requirement extraction is cached by JD content hash, so a posting is only extracted once across all users.
