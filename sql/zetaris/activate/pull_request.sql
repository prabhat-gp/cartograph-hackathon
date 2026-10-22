SELECT COALESCE(p.id, '') AS id, p.repo_id, p.number, p.title, p.body, p.state, p.author,
       CAST(p.created_at AS timestamp) AS created_at, CAST(p.merged_at AS timestamp) AS merged_at, p.merge_commit_sha,
       CAST(COALESCE(i.n, 0) AS int) AS issue_count, CAST(COALESCE(d.n, 0) AS int) AS discussion_count, p.url
FROM ${source}.pull_request p
LEFT JOIN (SELECT pr_id, COUNT(*) AS n FROM ${source}.pr_issue GROUP BY pr_id) i ON i.pr_id = p.id
LEFT JOIN (SELECT parent_id, COUNT(*) AS n FROM ${source}.discussion GROUP BY parent_id) d ON d.parent_id = p.id
