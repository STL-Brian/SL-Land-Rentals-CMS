-- Cycle-3 retry snapshots and operator recovery state.
ALTER TABLE stripe_checkout_attempts ADD COLUMN IF NOT EXISTS provider_expires_at bigint;
UPDATE stripe_checkout_attempts SET provider_expires_at=extract(epoch FROM created_at)::bigint+31*60 WHERE provider_expires_at IS NULL;
ALTER TABLE stripe_checkout_attempts ALTER COLUMN provider_expires_at SET NOT NULL;

ALTER TABLE provider_actions DROP CONSTRAINT IF EXISTS provider_actions_state_check;
ALTER TABLE provider_actions ADD CONSTRAINT provider_actions_state_check CHECK(state IN ('QUEUED','PROCESSING','SUCCEEDED','FAILED','MANUAL_REVIEW','RESOLVED'));
