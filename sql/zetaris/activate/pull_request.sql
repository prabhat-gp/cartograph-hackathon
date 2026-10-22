SELECT COALESCE(id, '') AS id, repo_id, number, title, body, state, author,
       CAST(created_at AS timestamp) AS created_at, CAST(merged_at AS timestamp) AS merged_at, merge_commit_sha,
       issue_count, discussion_count, url
FROM ${source}.pull_request
