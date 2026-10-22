-- Evidence store: the raw material every "why" answer is built from.
-- Ingested from git (commits, blame) and GitHub (pull requests, issues,
-- reviews). Zetaris reads these tables over JDBC and layers the
-- provenance USL on top of them. Scalar columns only: USL can't model
-- arrays or structs.

CREATE TABLE IF NOT EXISTS repository (
  id             text PRIMARY KEY,          -- owner/name
  default_branch text NOT NULL,
  description    text,
  url            text NOT NULL,
  head_sha       text NOT NULL,
  ingested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_file (
  id       text PRIMARY KEY,                -- owner/name:path
  repo_id  text NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  path     text NOT NULL,
  language text,
  lines    integer NOT NULL
);

CREATE TABLE IF NOT EXISTS git_commit (
  sha          text PRIMARY KEY,
  repo_id      text NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  author_name  text NOT NULL,
  author_email text,
  authored_at  timestamptz NOT NULL,
  subject      text NOT NULL,
  body         text,
  url          text NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_file (
  commit_sha text NOT NULL REFERENCES git_commit(sha) ON DELETE CASCADE,
  file_id    text NOT NULL,               -- may name a file deleted since
  additions  integer NOT NULL,
  deletions  integer NOT NULL,
  PRIMARY KEY (commit_sha, file_id)
);

-- git blame at head, collapsed into ranges: lines [line_start, line_end]
-- of a file were last changed by commit_sha.
CREATE TABLE IF NOT EXISTS line_origin (
  file_id    text NOT NULL REFERENCES source_file(id) ON DELETE CASCADE,
  line_start integer NOT NULL,
  line_end   integer NOT NULL,
  commit_sha text NOT NULL,
  PRIMARY KEY (file_id, line_start)
);

CREATE TABLE IF NOT EXISTS pull_request (
  id               text PRIMARY KEY,        -- owner/name#number
  repo_id          text NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  number           integer NOT NULL,
  title            text NOT NULL,
  body             text,
  state            text NOT NULL,           -- OPEN, CLOSED, MERGED
  author           text,
  created_at       timestamptz NOT NULL,
  merged_at        timestamptz,
  merge_commit_sha text,
  url              text NOT NULL
);

CREATE TABLE IF NOT EXISTS pr_commit (
  pr_id      text NOT NULL REFERENCES pull_request(id) ON DELETE CASCADE,
  commit_sha text NOT NULL,
  PRIMARY KEY (pr_id, commit_sha)
);

CREATE TABLE IF NOT EXISTS issue (
  id         text PRIMARY KEY,              -- owner/name#number
  repo_id    text NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  number     integer NOT NULL,
  title      text NOT NULL,
  body       text,
  state      text NOT NULL,
  labels     text,                          -- comma-separated
  author     text,
  created_at timestamptz NOT NULL,
  closed_at  timestamptz,
  url        text NOT NULL
);

-- closes: the PR says it fixes the issue; mentions: it only refers to it.
CREATE TABLE IF NOT EXISTS pr_issue (
  pr_id    text NOT NULL REFERENCES pull_request(id) ON DELETE CASCADE,
  issue_id text NOT NULL,
  relation text NOT NULL,
  PRIMARY KEY (pr_id, issue_id)
);

-- Discussion on a PR or issue: comments, reviews and inline review comments.
CREATE TABLE IF NOT EXISTS discussion (
  id         text PRIMARY KEY,
  repo_id    text NOT NULL REFERENCES repository(id) ON DELETE CASCADE,
  parent_id  text NOT NULL,                 -- pull_request.id or issue.id
  kind       text NOT NULL,                 -- comment, review, review_comment
  author     text,
  created_at timestamptz NOT NULL,
  body       text NOT NULL,
  path       text,                          -- review_comment only
  line       integer,
  url        text NOT NULL
);

CREATE INDEX IF NOT EXISTS line_origin_commit ON line_origin (commit_sha);
CREATE INDEX IF NOT EXISTS pr_commit_commit ON pr_commit (commit_sha);
CREATE INDEX IF NOT EXISTS commit_file_file ON commit_file (file_id);
CREATE INDEX IF NOT EXISTS discussion_parent ON discussion (parent_id);
