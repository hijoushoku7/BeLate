CREATE TABLE notification_usage (
  month TEXT PRIMARY KEY,
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0)
);
