SELECT COALESCE(id, '') AS id, default_branch, description, url, head_sha
FROM ${source}.repository
