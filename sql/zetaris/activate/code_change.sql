SELECT COALESCE(c.sha, '') AS sha, c.repo_id, c.author_name, CAST(c.authored_at AS timestamp) AS authored_at,
       c.subject, c.body, pc.pr_id, c.url
FROM ${source}.git_commit c
LEFT JOIN (SELECT commit_sha, MIN(pr_id) AS pr_id FROM ${source}.pr_commit GROUP BY commit_sha) pc
  ON pc.commit_sha = c.sha
