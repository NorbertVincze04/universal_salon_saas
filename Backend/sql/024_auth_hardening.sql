-- Revokes sessions on password change: tokens issued before this timestamp
-- are rejected by the auth middleware.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Caps guesses per emailed reset code so the 6-digit space cannot be brute forced.
ALTER TABLE password_reset_codes
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
