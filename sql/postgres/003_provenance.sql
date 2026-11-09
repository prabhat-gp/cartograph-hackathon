-- The provenance layer as plain Postgres views, shaped like the USL tables in
-- sql/zetaris so the Investigator's queries run here unchanged when Zetaris
-- isn't configured.
CREATE SCHEMA IF NOT EXISTS provenance;

CREATE OR REPLACE VIEW provenance.repository AS
  SELECT id, default_branch, description, url, head_sha FROM public.repository;
CREATE OR REPLACE VIEW provenance.source_file AS
  SELECT id, repo_id, path, language, lines FROM public.source_file;
CREATE OR REPLACE VIEW provenance.code_change AS
  SELECT sha, repo_id, author_name, authored_at, subject, body, pr_id, url FROM public.git_commit;
CREATE OR REPLACE VIEW provenance.file_change AS
  SELECT commit_sha || '>' || file_id AS id, commit_sha, file_id, additions, deletions FROM public.commit_file;
CREATE OR REPLACE VIEW provenance.line_origin AS
  SELECT file_id || ':' || line_start AS id, file_id, line_start, line_end, commit_sha FROM public.line_origin;
CREATE OR REPLACE VIEW provenance.pull_request AS
  SELECT id, repo_id, number, title, body, state, author, created_at, merged_at, merge_commit_sha,
         issue_count, discussion_count, url
  FROM public.pull_request;
CREATE OR REPLACE VIEW provenance.issue AS
  SELECT id, repo_id, number, title, body, state, labels, author, created_at, closed_at, url FROM public.issue;
CREATE OR REPLACE VIEW provenance.pr_issue AS
  SELECT pr_id || '>' || issue_id AS id, pr_id, issue_id, relation FROM public.pr_issue;
CREATE OR REPLACE VIEW provenance.discussion AS
  SELECT id, repo_id, parent_id, kind, author, created_at, body, path, line, url FROM public.discussion;
