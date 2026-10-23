SELECT COALESCE(id, '') AS id, repo_id, path, language, lines
FROM ${source}.source_file
