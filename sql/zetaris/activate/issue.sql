SELECT COALESCE(id, '') AS id, repo_id, number, title, body, state, labels, author,
       CAST(created_at AS timestamp) AS created_at, CAST(closed_at AS timestamp) AS closed_at, url
FROM ${source}.issue
