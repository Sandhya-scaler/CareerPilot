-- Phase 4: mock interviews, weekly reports, GitHub import.

CREATE TABLE interview_sessions (
  id          uuid PRIMARY KEY,               -- == LangGraph thread_id
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id      uuid REFERENCES jobs(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done')),
  question_ids uuid[] NOT NULL,
  summary     jsonb,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE INDEX interview_sessions_user_idx ON interview_sessions(user_id, started_at DESC);

CREATE TABLE attempts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id          uuid REFERENCES questions(id) ON DELETE SET NULL,
  interview_session_id uuid REFERENCES interview_sessions(id) ON DELETE CASCADE,
  prompt               text NOT NULL,          -- the question as asked (follow-ups differ from the bank)
  is_followup          boolean NOT NULL DEFAULT false,
  answer               text NOT NULL,
  score                smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  covered              jsonb NOT NULL,         -- rubric points covered
  missed               jsonb NOT NULL,         -- rubric points missed
  feedback             text NOT NULL,
  graded_by            text NOT NULL,          -- 'llm' | 'keywords'
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempts_user_idx ON attempts(user_id, created_at DESC);

CREATE TABLE weekly_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  date NOT NULL,
  readiness   real,
  content     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

ALTER TABLE users ADD COLUMN github_username text;

-- Ghost-job signals: when a saved posting disappeared from its company board.
ALTER TABLE jobs ADD COLUMN delisted_at timestamptz;
