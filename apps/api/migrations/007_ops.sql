-- Phase 5: LLM usage accounting (cost per user per week).
CREATE TABLE llm_usage (
  id            bigserial PRIMARY KEY,
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  label         text NOT NULL,           -- jd-extraction, plan, grading, ...
  model         text NOT NULL,
  input_tokens  int NOT NULL,
  output_tokens int NOT NULL,
  cache_read_tokens int NOT NULL DEFAULT 0,
  cost_usd      numeric(10, 6) NOT NULL,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX llm_usage_user_idx ON llm_usage(user_id, at);
