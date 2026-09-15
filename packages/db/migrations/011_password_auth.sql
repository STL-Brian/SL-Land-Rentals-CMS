ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS auth_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  avatar_id uuid,
  canonical_username text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('PASSWORD_SETUP', 'PASSWORD_RESET')),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR purpose = 'PASSWORD_SETUP')
);
CREATE INDEX IF NOT EXISTS auth_grants_active_idx ON auth_grants(token_hash) WHERE consumed_at IS NULL;
