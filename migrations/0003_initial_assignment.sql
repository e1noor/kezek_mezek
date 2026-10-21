-- The supplied timetable. These rows are inserted once and remain editable by admins.
INSERT OR IGNORE INTO subjects (name, color) VALUES
  ('Operating Systems', '#4F82D9'),
  ('Design and Analysis of Algorithms', '#6867DD'),
  ('Web Technologies I (Frontend)', '#A670D7'),
  ('Introduction to Finance', '#D29650'),
  ('Kazakh (Russian) Language I (Advanced)', '#D57891');

INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 1, '11:00', '13:00', 'IEC-308', 'practical' FROM subjects WHERE name = 'Operating Systems';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 2, '17:00', '17:50', 'C.1.2141K', 'practical' FROM subjects WHERE name = 'Operating Systems';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 1, '14:00', '15:50', 'C.1.2124', 'practical' FROM subjects WHERE name = 'Design and Analysis of Algorithms';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 2, '16:00', '16:50', 'C.1.223K', 'practical' FROM subjects WHERE name = 'Design and Analysis of Algorithms';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 1, '16:00', '17:50', 'C.1.245K', 'practical' FROM subjects WHERE name = 'Web Technologies I (Frontend)';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 3, '19:00', '19:50', 'C.1.3264L', 'practical' FROM subjects WHERE name = 'Web Technologies I (Frontend)';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 2, '18:00', '19:50', 'C.1.223P', 'practical' FROM subjects WHERE name = 'Introduction to Finance';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 3, '17:00', '17:50', 'C.1.2226P', 'practical' FROM subjects WHERE name = 'Introduction to Finance';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 4, '14:00', '15:50', 'C.1.3234L', 'practical' FROM subjects WHERE name = 'Introduction to Finance';
INSERT OR IGNORE INTO schedule_rules (subject_id, weekday, start_time, end_time, room, kind)
SELECT id, 4, '16:00', '17:50', 'C.1.256P', 'practical' FROM subjects WHERE name = 'Kazakh (Russian) Language I (Advanced)';

INSERT INTO assignments (subject_id, title, instructor, submission_due_at, defense_week_start, source)
SELECT id, 'Assignment 2', 'Rakhymbayeva Zhaniya', '2026-10-07 23:59', '2026-10-05', 'lighthouse'
FROM subjects WHERE name = 'Design and Analysis of Algorithms'
  AND NOT EXISTS (
    SELECT 1 FROM assignments a WHERE a.subject_id = subjects.id
      AND a.title = 'Assignment 2' COLLATE NOCASE AND a.submission_due_at = '2026-10-07 23:59'
  );

INSERT OR IGNORE INTO defense_sessions
  (assignment_id, session_date, start_time, end_time, room, schedule_rule_id)
SELECT a.id, '2026-10-05', r.start_time, r.end_time, r.room, r.id
FROM assignments a JOIN subjects s ON s.id = a.subject_id
JOIN schedule_rules r ON r.subject_id = s.id AND r.weekday = 1 AND r.start_time = '14:00'
WHERE s.name = 'Design and Analysis of Algorithms' AND a.title = 'Assignment 2'
  AND a.submission_due_at = '2026-10-07 23:59';

INSERT OR IGNORE INTO defense_sessions
  (assignment_id, session_date, start_time, end_time, room, schedule_rule_id)
SELECT a.id, '2026-10-06', r.start_time, r.end_time, r.room, r.id
FROM assignments a JOIN subjects s ON s.id = a.subject_id
JOIN schedule_rules r ON r.subject_id = s.id AND r.weekday = 2 AND r.start_time = '16:00'
WHERE s.name = 'Design and Analysis of Algorithms' AND a.title = 'Assignment 2'
  AND a.submission_due_at = '2026-10-07 23:59';
