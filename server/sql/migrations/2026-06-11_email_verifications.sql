-- Code-based sign-up verification: hold the pending registration until the
-- emailed 6-digit code is confirmed, then provision the account. Idempotent.
CREATE TABLE IF NOT EXISTS app.email_verifications (
  email         TEXT        PRIMARY KEY,            -- lowercased
  password_hash TEXT        NOT NULL,
  full_name     TEXT        NOT NULL,
  company_name  TEXT        NOT NULL,
  code_hash     TEXT        NOT NULL,               -- sha256 of the 6-digit code
  attempts      INTEGER     NOT NULL DEFAULT 0,     -- wrong-code guesses (capped)
  expires_at    TIMESTAMPTZ NOT NULL,              -- code TTL (15 min)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
