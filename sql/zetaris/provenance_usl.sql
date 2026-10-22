COMPILE USL IF NOT EXISTS provenance DEPLOY NAMESPACE lightning.metastore.cartograph DDL
CREATE TABLE repository (
  id varchar(200) NOT NULL PRIMARY KEY,
  default_branch varchar(200),
  description varchar(2000),
  url varchar(500),
  head_sha varchar(40)
);
CREATE TABLE source_file (
  id varchar(800) NOT NULL PRIMARY KEY,
  repo_id varchar(200) FOREIGN KEY REFERENCES repository(id),
  path varchar(600),
  language varchar(40),
  lines int
);
CREATE TABLE code_change (
  sha varchar(40) NOT NULL PRIMARY KEY,
  repo_id varchar(200) FOREIGN KEY REFERENCES repository(id),
  author_name varchar(300),
  authored_at timestamp,
  subject varchar(2000),
  body varchar(60000),
  pr_id varchar(220),
  url varchar(500)
);
CREATE TABLE file_change (
  id varchar(850) NOT NULL PRIMARY KEY,
  commit_sha varchar(40) FOREIGN KEY REFERENCES code_change(sha),
  file_id varchar(800),
  additions int,
  deletions int
);
CREATE TABLE line_origin (
  id varchar(820) NOT NULL PRIMARY KEY,
  file_id varchar(800) FOREIGN KEY REFERENCES source_file(id),
  line_start int,
  line_end int,
  commit_sha varchar(40) FOREIGN KEY REFERENCES code_change(sha)
);
CREATE TABLE pull_request (
  id varchar(220) NOT NULL PRIMARY KEY,
  repo_id varchar(200) FOREIGN KEY REFERENCES repository(id),
  number int,
  title varchar(2000),
  body varchar(60000),
  state varchar(20),
  author varchar(200),
  created_at timestamp,
  merged_at timestamp,
  merge_commit_sha varchar(40),
  issue_count int,
  discussion_count int,
  url varchar(500)
);
CREATE TABLE issue (
  id varchar(220) NOT NULL PRIMARY KEY,
  repo_id varchar(200) FOREIGN KEY REFERENCES repository(id),
  number int,
  title varchar(2000),
  body varchar(60000),
  state varchar(20),
  labels varchar(1000),
  author varchar(200),
  created_at timestamp,
  closed_at timestamp,
  url varchar(500)
);
CREATE TABLE pr_issue (
  id varchar(450) NOT NULL PRIMARY KEY,
  pr_id varchar(220) FOREIGN KEY REFERENCES pull_request(id),
  issue_id varchar(220) FOREIGN KEY REFERENCES issue(id),
  relation varchar(20)
);
CREATE TABLE discussion (
  id varchar(200) NOT NULL PRIMARY KEY,
  repo_id varchar(200) FOREIGN KEY REFERENCES repository(id),
  parent_id varchar(220),
  kind varchar(20),
  author varchar(200),
  created_at timestamp,
  body varchar(60000),
  path varchar(600),
  line int,
  url varchar(500)
)
