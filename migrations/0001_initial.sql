PRAGMA foreign_keys = ON;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  is_friend INTEGER NOT NULL DEFAULT 0 CHECK (is_friend IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE groups (
  line_group_id TEXT PRIMARY KEY,
  doubt_enabled INTEGER NOT NULL DEFAULT 1 CHECK (doubt_enabled IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(line_group_id),
  owner_id TEXT NOT NULL REFERENCES users(user_id),
  place_lat REAL NOT NULL,
  place_lng REAL NOT NULL,
  place_name TEXT,
  meet_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft', 'open', 'locked', 'running', 'settled')),
  base_fine INTEGER NOT NULL CHECK (base_fine >= 0),
  per_min INTEGER NOT NULL CHECK (per_min >= 0),
  max_fine INTEGER NOT NULL CHECK (max_fine >= 0),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE UNIQUE INDEX one_active_event_per_group
  ON events(group_id) WHERE state <> 'settled';
CREATE INDEX events_due ON events(state, meet_at);

CREATE TABLE participants (
  event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  status TEXT NOT NULL CHECK (status IN ('joining', 'absent')),
  joined_at INTEGER NOT NULL,
  arrived_at INTEGER,
  arrival_lat REAL,
  arrival_lng REAL,
  late_minutes INTEGER,
  fine INTEGER,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX participants_user ON participants(user_id);

CREATE TABLE bets (
  event_id TEXT NOT NULL REFERENCES events(id),
  bettor_id TEXT NOT NULL REFERENCES users(user_id),
  target_id TEXT NOT NULL REFERENCES users(user_id),
  predicts_late INTEGER NOT NULL CHECK (predicts_late IN (0, 1)),
  stake INTEGER NOT NULL DEFAULT 300,
  payout INTEGER,
  PRIMARY KEY (event_id, bettor_id, target_id),
  CHECK (bettor_id <> target_id)
);

CREATE TABLE reports (
  event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  distance_m INTEGER NOT NULL,
  reported_at INTEGER NOT NULL
);

CREATE INDEX reports_event_user ON reports(event_id, user_id);

-- Ensures the once-only late reminder across cron retries.
CREATE TABLE reminders (
  event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
