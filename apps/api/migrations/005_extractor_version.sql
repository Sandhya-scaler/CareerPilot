-- Requirement extraction is cached by content hash; the version lets improved extractors refresh old jobs.
ALTER TABLE jobs ADD COLUMN extractor_version int NOT NULL DEFAULT 0;
