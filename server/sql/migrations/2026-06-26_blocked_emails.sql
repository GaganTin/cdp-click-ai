-- 2026-06-26  Blocked emails (deleted-account lockout)
-- Emails from deleted accounts must never sign up or sign in again, on any
-- provider. No foreign key so the row survives the account-deletion cascade.
CREATE TABLE IF NOT EXISTS app.blocked_emails (
  email      TEXT        PRIMARY KEY,          -- stored lowercased
  reason     TEXT        NOT NULL DEFAULT 'account_deleted',
  account_id UUID,                             -- the now-deleted account (no FK)
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
