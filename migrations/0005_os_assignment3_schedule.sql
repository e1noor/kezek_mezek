-- The manually edited Sunday queue belongs to the Monday OS practical class.
-- Keep its existing queue ID and student places while correcting its date.
DELETE FROM defense_sessions
WHERE assignment_id = (
  SELECT a.id FROM assignments a JOIN subjects s ON s.id = a.subject_id
  WHERE s.name = 'Operating Systems' AND a.title = 'Assignment _3' LIMIT 1
)
  AND session_date IN ('2026-09-28', '2026-09-29')
  AND NOT EXISTS (SELECT 1 FROM queue_entries q WHERE q.session_id = defense_sessions.id);

UPDATE defense_sessions
SET session_date = '2026-10-05', start_time = '11:00', end_time = '13:00', room = 'IEC-308',
    schedule_rule_id = (
      SELECT r.id FROM schedule_rules r JOIN subjects s ON s.id = r.subject_id
      WHERE s.name = 'Operating Systems' AND r.weekday = 1 AND r.start_time = '11:00' LIMIT 1
    )
WHERE assignment_id = (
  SELECT a.id FROM assignments a JOIN subjects s ON s.id = a.subject_id
  WHERE s.name = 'Operating Systems' AND a.title = 'Assignment _3' LIMIT 1
)
  AND session_date = '2026-10-04' AND start_time = '10:00';

UPDATE assignments SET defense_week_start = '2026-10-05'
WHERE id = (
  SELECT a.id FROM assignments a JOIN subjects s ON s.id = a.subject_id
  WHERE s.name = 'Operating Systems' AND a.title = 'Assignment _3' LIMIT 1
);

INSERT OR IGNORE INTO defense_sessions
  (assignment_id, session_date, start_time, end_time, room, schedule_rule_id)
SELECT a.id, '2026-10-06', r.start_time, r.end_time, r.room, r.id
FROM assignments a JOIN subjects s ON s.id = a.subject_id
JOIN schedule_rules r ON r.subject_id = s.id AND r.weekday = 2 AND r.active = 1
WHERE s.name = 'Operating Systems' AND a.title = 'Assignment _3';
