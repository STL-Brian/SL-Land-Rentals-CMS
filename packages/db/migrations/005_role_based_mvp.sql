-- Role expansion and explicit staff-created reservations.
-- Replace the legacy enum in one transaction-safe migration so the new default
-- can be used immediately on both existing and clean databases.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='user_role' AND e.enumlabel='ADMIN'
  ) THEN
    ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
    ALTER TYPE user_role RENAME TO user_role_legacy;
    CREATE TYPE user_role AS ENUM ('ADMINISTRATOR','MANAGER','AGENT','RENTER','RESIDENT');
    ALTER TABLE users ALTER COLUMN role TYPE user_role USING (
      CASE role::text WHEN 'ADMIN' THEN 'ADMINISTRATOR' ELSE role::text END
    )::user_role;
    DROP TYPE user_role_legacy;
  END IF;
END $$;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'RESIDENT';
ALTER TABLE users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('ACTIVE','CANCELLED','EXPIRED','COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id),
  target_user_id uuid NOT NULL REFERENCES users(id),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  status reservation_status NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz NOT NULL,
  notes text NOT NULL DEFAULT '',
  cancellation_reason text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (expires_at > created_at),
  UNIQUE (created_by_user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_live_reservation
  ON reservations(listing_id) WHERE status='ACTIVE';
CREATE INDEX IF NOT EXISTS reservations_target_history
  ON reservations(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reservations_expiry
  ON reservations(expires_at) WHERE status='ACTIVE';
