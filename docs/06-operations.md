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
| `ANTHROPIC_API_KEY` | no | Claude (paid, best quality) for extraction, plans, questions, rewording, grading |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_EXTRACTION_MODEL` | no | **Free alternative**: any OpenAI-compatible API (Gemini free tier, Groq, local Ollama). Used only when `ANTHROPIC_API_KEY` is empty; hosted URLs need a key |
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

## Free AI layer (optional)
CareerPilot works fully without AI. To add it for free:

**Google Gemini (free tier).** Create a key at https://aistudio.google.com/apikey (Google account, no card), then in `.env`:
```
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=your-key
LLM_MODEL=gemini-3.5-flash-lite
LLM_EXTRACTION_MODEL=gemini-3.5-flash-lite
LLM_FALLBACK_MODELS=gemini-3.1-flash-lite,gemini-3.6-flash,gemini-3.5-flash
LLM_TIMEOUT_MS=45000
LLM_TOTAL_BUDGET_MS=90000
```
The free tier sometimes answers 503 "high demand" or 429: CareerPilot retries with backoff, moves to the next fallback model on errors or timeouts, and finally uses the rules. Quota errors (429) skip straight to the next model; each AI step has a 90 s total budget (`LLM_TOTAL_BUDGET_MS`), so a user never waits longer than that before the rules answer instead.
Measured 2026-10-30 with a new free key: `gemini-3.5-flash-lite` answers in 3–4 s and has the most headroom, so it's the default for every step; `gemini-3.5-flash` hit its free daily quota (429) after a day of testing and sometimes took over 60 s; `gemini-2.5-flash` is closed to new users; Gemma 4 (`gemma-4-31b-it`) works but is slow (~22 s) and prefixes answers with `<thought>` text, so it's a poor fit for structured output. List the models your key can use with `curl -H "Authorization: Bearer $KEY" https://generativelanguage.googleapis.com/v1beta/openai/models`. Free-tier limits are per minute/day, and Google may use free-tier content to improve its products (the privacy page says so).

**Ollama (local, private, no key).** `brew install ollama && brew services start ollama && ollama pull qwen2.5:3b`, then `LLM_BASE_URL=http://localhost:11434/v1` and `LLM_MODEL=qwen2.5:3b`. Slower on an 8 GB laptop, but nothing leaves the machine.

Whatever the model, every AI output passes the same guards (taxonomy, verbatim sentences, grounding check). If a call fails or returns junk, the feature falls back to the rules.

## Deploying for free (Render + Neon, blueprint included)
1. **Database:** sign up at https://neon.tech (free, GitHub login) → create a project → copy the connection string (`postgres://…neon.tech/…?sslmode=require`). pgvector is available; migrations enable it on first boot.
2. **App:** sign up at https://render.com with GitHub → **New → Blueprint** → select `Sandhya-scaler/CareerPilot`. `render.yaml` creates `careerpilot-api` and `careerpilot-web` on free instances.
3. When prompted:
   - **API:** `DATABASE_URL` = the Neon string, `APP_URL` and `WEB_ORIGIN` = `https://careerpilot-web.onrender.com` (your web URL), `ADMIN_EMAILS` = your email, `LLM_API_KEY` = your Gemini key (or leave empty for rules only). Leave `SMTP_URL`/`EMAIL_FROM` empty unless you have an email provider.
   - **Web:** `API_URL` = `https://careerpilot-api.onrender.com` (your API URL; it's used at build time).
4. If the actual service URLs differ from what you entered, update those values and redeploy the web service.
5. Open the web URL and create your account. `/admin` works for `ADMIN_EMAILS`.

Free instances sleep after about 15 minutes idle, so the first visit afterwards takes about a minute. Scheduled jobs (daily ghost-job check, Monday emails) only run while the API is awake. Weekly reports are always built live when you open the page.

The blueprint follows Render's spec but hasn't been applied (that needs your account). If Render rejects a field, its dashboard shows which; paste the error and it can be fixed.

## Deploying elsewhere
- **DB:** Neon or Supabase (both support pgvector). Run against an empty database; migrations apply on boot.
- **API:** Railway / Fly.io / Render from `apps/api/Dockerfile` (build context = repo root). Any number of instances: rate limits and scheduled jobs coordinate through Postgres. Mount a volume at `apps/api/.cache` so the embedding model isn't downloaded on every deploy.
- **Web:** Vercel (root `apps/web`) with `API_URL` set to the API's public URL at build time. Cookies then pass through the rewrite as first-party.
- Set `NODE_ENV=production` (secure cookies) and serve over HTTPS.

## Data sources and terms
Only official public job-board APIs and user-pasted text. Remotive is intentionally not used (no redistribution, and ≤4 calls/day). Show Adzuna attribution if you enable it. Never add scrapers for LinkedIn, Naukri or Indeed.

## Costs
Every Claude call is recorded in `llm_usage` (tokens and USD), visible per user at `/account`. Requirement extraction is cached by JD content hash, so a posting is only extracted once across all users.
