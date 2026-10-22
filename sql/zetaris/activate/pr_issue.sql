SELECT COALESCE(CONCAT(pr_id, '>', issue_id), '') AS id, pr_id, issue_id, relation
FROM ${source}.pr_issue
