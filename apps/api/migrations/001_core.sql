-- Phase 0/1: users, skill taxonomy, resumes + evidence, jobs + requirements, match reports.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text UNIQUE NOT NULL,
  name           text,
  password_hash  text,
  target_role    text,
  location       text,
  hours_per_week int NOT NULL DEFAULT 8,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Skill taxonomy -------------------------------------------------------------
CREATE TABLE skills (
  id             serial PRIMARY KEY,
  canonical_name text UNIQUE NOT NULL,
  category       text NOT NULL,
  learnability   text NOT NULL DEFAULT 'weeks' CHECK (learnability IN ('days', 'weeks', 'months')),
  related        text[] NOT NULL DEFAULT '{}',
  embedding      vector(384)
);

CREATE TABLE skill_aliases (
  alias          text PRIMARY KEY,           -- lower-cased
  skill_id       int NOT NULL REFERENCES skills(id) ON DELETE CASCADE
);

-- Raw skill strings we could not map; reviewed to grow the taxonomy.
CREATE TABLE unknown_skills (
  raw            text PRIMARY KEY,
  seen_count     int NOT NULL DEFAULT 1,
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

-- Resumes + evidence -------------------------------------------------------------
CREATE TABLE resumes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resume_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id         uuid NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  parent_version_id uuid REFERENCES resume_versions(id) ON DELETE SET NULL,
  job_id            uuid,                       -- set for tailored versions (FK added below)
  label             text NOT NULL,
  raw_text          text NOT NULL,
  content           jsonb NOT NULL,             -- ParsedResume
  change_log        jsonb NOT NULL DEFAULT '[]',-- TailorEdit[] for tailored versions
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evidence_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_version_id uuid REFERENCES resume_versions(id) ON DELETE CASCADE,
  source            text NOT NULL CHECK (source IN ('resume', 'github', 'assessment', 'manual', 'plan')),
  section           text NOT NULL,
  context           text,                       -- e.g. project / job title the line belongs to
  text              text NOT NULL,
  tier              smallint NOT NULL CHECK (tier BETWEEN 0 AND 4),
  metrics           text[] NOT NULL DEFAULT '{}',
  links             text[] NOT NULL DEFAULT '{}',
  confirmed         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_user_idx ON evidence_items(user_id);

CREATE TABLE evidence_skills (
  evidence_id       uuid NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  skill_id          int NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (evidence_id, skill_id)
);

-- Jobs -------------------------------------------------------------
CREATE TABLE jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source         text NOT NULL,              -- pasted | greenhouse | lever | ashby | adzuna | ...
  source_id      text NOT NULL,
  url            text,
  company        text,
  title          text NOT NULL,
  location       text,
  remote         boolean,
  posted_at      timestamptz,
  fetched_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  description    text NOT NULL,
  content_hash   text NOT NULL,
  ghost_risk     real,
  ghost_reasons  text[] NOT NULL DEFAULT '{}',
  embedding      vector(384),
  UNIQUE (source, source_id)
);
CREATE INDEX jobs_hash_idx ON jobs(content_hash);
CREATE INDEX jobs_embedding_idx ON jobs USING hnsw (embedding vector_cosine_ops);

ALTER TABLE resume_versions
  ADD CONSTRAINT resume_versions_job_fk FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;

-- Which users have saved/analyzed which jobs (jobs themselves are shared + cached).
CREATE TABLE user_jobs (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id         uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE job_requirements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id        int NOT NULL REFERENCES skills(id),
  kind            text NOT NULL CHECK (kind IN ('must', 'nice')),
  years_min       real,
  source_sentence text NOT NULL,
  UNIQUE (job_id, skill_id)
);

-- Match reports -------------------------------------------------------------
CREATE TABLE match_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id            uuid REFERENCES jobs(id) ON DELETE CASCADE,
  market_map_id     uuid,                      -- FK added in 002
  resume_version_id uuid REFERENCES resume_versions(id) ON DELETE SET NULL,
  coverage          real NOT NULL,
  summary           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE match_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES match_reports(id) ON DELETE CASCADE,
  skill_id        int NOT NULL REFERENCES skills(id),
  importance      real NOT NULL,
  evidence_score  real NOT NULL,
  via             text NOT NULL CHECK (via IN ('direct', 'adjacent', 'none')),
  evidence_id     uuid REFERENCES evidence_items(id) ON DELETE SET NULL,
  requirement_id  uuid REFERENCES job_requirements(id) ON DELETE SET NULL,
  requirement_text text,
  evidence_text   text,
  explanation     text
);
CREATE INDEX match_items_report_idx ON match_items(report_id);
