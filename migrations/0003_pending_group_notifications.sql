CREATE TABLE pending_group_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL REFERENCES groups(line_group_id),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  notified_at INTEGER
);

CREATE INDEX pending_group_notifications_group
  ON pending_group_notifications(group_id, notified_at, id);
