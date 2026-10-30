-- Phase 1: richer match reports.
ALTER TABLE match_reports ADD COLUMN must_coverage real NOT NULL DEFAULT 0;
ALTER TABLE match_items ADD COLUMN kind text NOT NULL DEFAULT 'must' CHECK (kind IN ('must', 'nice'));
ALTER TABLE match_items ADD COLUMN via_skill text;
ALTER TABLE match_items ADD COLUMN scored boolean NOT NULL DEFAULT true;
ALTER TABLE match_items ADD COLUMN evidence_tier smallint;
ALTER TABLE match_items ADD COLUMN evidence_context text;
ALTER TABLE match_items DROP CONSTRAINT match_items_via_check;
ALTER TABLE match_items ADD CONSTRAINT match_items_via_check CHECK (via IN ('direct', 'implied', 'adjacent', 'none'));
