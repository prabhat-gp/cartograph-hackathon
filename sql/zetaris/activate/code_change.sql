SELECT COALESCE(sha, '') AS sha, repo_id, author_name, CAST(authored_at AS timestamp) AS authored_at,
       subject, body, pr_id, url
FROM ${source}.git_commit
