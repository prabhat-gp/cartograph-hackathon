SELECT COALESCE(CONCAT(commit_sha, '>', file_id), '') AS id, commit_sha, file_id, additions, deletions
FROM ${source}.commit_file
