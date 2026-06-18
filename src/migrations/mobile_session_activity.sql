-- Mobile session inactivity tracking
-- Used to expire app sessions when the mobile app has not been opened for 14 days.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mobile_last_seen_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_users_mobile_last_seen_at
  ON users(mobile_last_seen_at);
