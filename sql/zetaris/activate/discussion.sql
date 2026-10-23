SELECT COALESCE(id, '') AS id, repo_id, parent_id, kind, author, CAST(created_at AS timestamp) AS created_at,
       body, path, line, url
FROM ${source}.discussion
