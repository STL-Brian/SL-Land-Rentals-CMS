ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'UNKNOWN' CHECK (health_status IN ('UNKNOWN','HEALTHY','STALE','UNREACHABLE')),
  ADD COLUMN IF NOT EXISTS health_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS health_check_id text;
CREATE INDEX IF NOT EXISTS terminal_health_status ON terminals (health_status, health_checked_at);
