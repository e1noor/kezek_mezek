DROP TRIGGER IF EXISTS queue_one_spot_per_assignment_day_insert;
DROP TRIGGER IF EXISTS queue_one_spot_per_assignment_day_update;

CREATE TRIGGER queue_one_spot_per_assignment_insert
BEFORE INSERT ON queue_entries
WHEN EXISTS (
  SELECT 1 FROM queue_entries existing
  JOIN defense_sessions existing_session ON existing_session.id = existing.session_id
  JOIN defense_sessions incoming_session ON incoming_session.id = NEW.session_id
  WHERE existing.telegram_id = NEW.telegram_id
    AND existing_session.assignment_id = incoming_session.assignment_id
    AND existing.session_id <> NEW.session_id
)
BEGIN
  SELECT RAISE(ABORT, 'One spot per assignment');
END;

CREATE TRIGGER queue_one_spot_per_assignment_update
BEFORE UPDATE OF session_id, telegram_id ON queue_entries
WHEN EXISTS (
  SELECT 1 FROM queue_entries existing
  JOIN defense_sessions existing_session ON existing_session.id = existing.session_id
  JOIN defense_sessions incoming_session ON incoming_session.id = NEW.session_id
  WHERE existing.telegram_id = NEW.telegram_id
    AND existing_session.assignment_id = incoming_session.assignment_id
    AND existing.id <> OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'One spot per assignment');
END;
