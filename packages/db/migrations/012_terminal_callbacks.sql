ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS callback_url text,
  ADD COLUMN IF NOT EXISTS callback_generation bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS callback_registered_at timestamptz;

DO $$ BEGIN
  ALTER TABLE terminals ADD CONSTRAINT terminal_callback_url_length CHECK (callback_url IS NULL OR length(callback_url) BETWEEN 16 AND 2048);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
