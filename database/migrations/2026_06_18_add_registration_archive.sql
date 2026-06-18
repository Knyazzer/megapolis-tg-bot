ALTER TABLE registrations
  ADD COLUMN archived_at DATETIME NULL AFTER approved_at;

CREATE INDEX idx_registrations_archived ON registrations (archived_at);
