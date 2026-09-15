-- Allow the real SL bot to resolve first-login account names before OTP delivery.
ALTER TABLE login_challenges ALTER COLUMN avatar_id DROP NOT NULL;
ALTER TABLE bot_outbox ALTER COLUMN avatar_id DROP NOT NULL;
ALTER TABLE bot_outbox ADD COLUMN IF NOT EXISTS target_username text;

DO $$
BEGIN
  ALTER TABLE bot_outbox ADD CONSTRAINT bot_outbox_delivery_target
    CHECK (avatar_id IS NOT NULL OR target_username IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
