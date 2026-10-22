SELECT COALESCE(CONCAT(file_id, ':', CAST(line_start AS string)), '') AS id, file_id, line_start, line_end, commit_sha
FROM ${source}.line_origin
