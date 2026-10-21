-- Extra assignment days are independent of the weekly practical timetable.
ALTER TABLE defense_sessions ADD COLUMN is_additional INTEGER NOT NULL DEFAULT 0 CHECK (is_additional IN (0, 1));
