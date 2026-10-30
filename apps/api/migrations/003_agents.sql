-- Phase 2: market maps, prep plans, practice questions, agent runs.

CREATE TABLE market_maps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL,
  location    text,
  job_ids     uuid[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_maps_user_idx ON market_maps(user_id, created_at DESC);

CREATE TABLE market_skills (
  market_map_id uuid NOT NULL REFERENCES market_maps(id) ON DELETE CASCADE,
  skill_id      int NOT NULL REFERENCES skills(id),
  frequency     real NOT NULL,
  must_rate     real NOT NULL,
  weight        real NOT NULL,
  job_count     int NOT NULL,
  -- one representative JD sentence for the evidence link
  sample_sentence text,
  PRIMARY KEY (market_map_id, skill_id)
);

ALTER TABLE match_reports
  ADD CONSTRAINT match_reports_market_fk FOREIGN KEY (market_map_id) REFERENCES market_maps(id) ON DELETE CASCADE;

CREATE TABLE plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_map_id  uuid REFERENCES market_maps(id) ON DELETE SET NULL,
  role           text NOT NULL,
  start_date     date NOT NULL,
  weeks          int NOT NULL,
  hours_per_week int NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  generated_by   text NOT NULL DEFAULT 'rules',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plans_user_idx ON plans(user_id, created_at DESC);

CREATE TABLE plan_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id        uuid NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  week           int NOT NULL,
  position       int NOT NULL,
  skill_id       int REFERENCES skills(id),
  type           text NOT NULL CHECK (type IN ('learn', 'build', 'prove', 'practice')),
  title          text NOT NULL,
  detail         text NOT NULL,
  resource_url   text,
  est_hours      real NOT NULL,
  proof_artifact text,
  status         text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'skipped')),
  proof          text,                       -- what the user submitted on completion
  evidence_id    uuid REFERENCES evidence_items(id) ON DELETE SET NULL,
  completed_at   timestamptz
);
CREATE INDEX plan_tasks_plan_idx ON plan_tasks(plan_id, week, position);

CREATE TABLE questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id     uuid REFERENCES plans(id) ON DELETE CASCADE,
  job_id      uuid REFERENCES jobs(id) ON DELETE SET NULL,
  skill_id    int REFERENCES skills(id),
  kind        text NOT NULL CHECK (kind IN ('concept', 'applied', 'project', 'behavioral', 'jd')),
  prompt      text NOT NULL,
  rubric      jsonb NOT NULL,               -- string[] of points a strong answer covers
  grounding   text,                         -- JD sentence or evidence line the question came from
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX questions_user_idx ON questions(user_id, created_at DESC);

CREATE TABLE runs (
  id          uuid PRIMARY KEY,             -- == LangGraph thread_id
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  status      text NOT NULL CHECK (status IN ('running', 'waiting', 'done', 'failed')),
  input       jsonb NOT NULL,
  result      jsonb,
  pending     jsonb,                        -- interrupt payload shown to the user while waiting
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runs_user_idx ON runs(user_id, created_at DESC);

CREATE TABLE run_events (
  id       bigserial PRIMARY KEY,
  run_id   uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  at       timestamptz NOT NULL DEFAULT now(),
  step     text NOT NULL,
  message  text NOT NULL
);
CREATE INDEX run_events_run_idx ON run_events(run_id, id);
