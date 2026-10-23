-- One rule per statement: name | table | boolean expression.
-- A change merged without a pull request has no review trail to explain it.
has_review_trail | code_change | pr_id IS NOT NULL
-- A pull request should say why: link an issue or explain itself in the description.
states_a_reason | pull_request | issue_count > 0 OR length(COALESCE(body, '')) >= 120
