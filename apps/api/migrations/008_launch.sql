-- Launch readiness: weekly email opt-in, beta feedback, multi-instance rate limiting.

ALTER TABLE users ADD COLUMN email_reports boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE weekly_reports ADD COLUMN emailed_at timestamptz;

CREATE TABLE feedback (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  page       text NOT NULL,
  rating     smallint CHECK (rating BETWEEN 1 AND 5),
  message    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fixed-window counters shared by every API instance.
CREATE UNLOGGED TABLE rate_limits (
  key        text PRIMARY KEY,
  count      int NOT NULL,
  reset_at   timestamptz NOT NULL
);

-- Scheduler claims: a job runs only when its row can be atomically advanced (one instance wins).
CREATE TABLE job_runs (
  name     text PRIMARY KEY,
  last_run timestamptz NOT NULL
);
