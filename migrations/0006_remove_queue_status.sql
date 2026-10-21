-- Queue registration is always available; defense sessions no longer have a status.
ALTER TABLE defense_sessions DROP COLUMN status;
