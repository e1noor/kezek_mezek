ALTER TABLE assignments ADD COLUMN defense_week_start TEXT;

UPDATE assignments
SET defense_week_start = date(
  COALESCE(substr(submission_due_at, 1, 10), substr(created_at, 1, 10)),
  printf('-%d days', (CAST(strftime('%w', COALESCE(substr(submission_due_at, 1, 10), substr(created_at, 1, 10))) AS INTEGER) + 6) % 7)
);

DELETE FROM defense_sessions
WHERE schedule_rule_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM queue_entries q WHERE q.session_id = defense_sessions.id)
  AND (
    session_date < (SELECT defense_week_start FROM assignments a WHERE a.id = assignment_id)
    OR session_date >= date((SELECT defense_week_start FROM assignments a WHERE a.id = assignment_id), '+7 days')
  );
