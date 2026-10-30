-- Phase 3: application tracking.

CREATE TABLE applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id            uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_version_id uuid REFERENCES resume_versions(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'saved'
                    CHECK (status IN ('saved', 'applied', 'oa', 'interview', 'offer', 'rejected', 'withdrawn')),
  applied_at        timestamptz,
  next_followup_at  timestamptz,
  notes             text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);
CREATE INDEX applications_user_status_idx ON applications(user_id, status);

CREATE TABLE application_events (
  id             bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type           text NOT NULL,              -- status:<new>, note, followup_sent
  at             timestamptz NOT NULL DEFAULT now(),
  notes          text
);
CREATE INDEX application_events_app_idx ON application_events(application_id, at);
