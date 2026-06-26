-- Email-OTP two-factor authentication (opt-in). Mirrors the additions in
-- server/sql/02_accounts_auth.sql for already-provisioned databases.
-- Non-destructive and idempotent (IF NOT EXISTS), safe to re-run.

-- Opt-in flag on the login identity.
ALTER TABLE app.users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;

-- Short-lived 6-digit codes for the second factor (login) and for confirming
-- the user can receive codes when turning 2FA on (enable). Raw code never stored.
CREATE TABLE IF NOT EXISTS app.mfa_challenges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  purpose     TEXT        NOT NULL DEFAULT 'login'
                CHECK (purpose IN ('login','enable')),
  code_hash   TEXT        NOT NULL,
  attempts    INTEGER     NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mfa_challenges_user_idx ON app.mfa_challenges(user_id);
