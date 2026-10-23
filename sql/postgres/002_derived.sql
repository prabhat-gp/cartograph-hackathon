-- Derived columns kept in the store itself, refreshed after each ingest.
-- Zetaris reads them as plain columns: aggregating over the JDBC source
-- inside a USL activation query fails in Spark (NativeAggregate).
ALTER TABLE git_commit ADD COLUMN IF NOT EXISTS pr_id text;
ALTER TABLE pull_request ADD COLUMN IF NOT EXISTS issue_count integer NOT NULL DEFAULT 0;
ALTER TABLE pull_request ADD COLUMN IF NOT EXISTS discussion_count integer NOT NULL DEFAULT 0;
