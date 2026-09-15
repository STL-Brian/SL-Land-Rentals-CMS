CREATE TABLE IF NOT EXISTS terminal_callback_deliveries (
  id bigserial PRIMARY KEY,
  terminal_id uuid NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  callback_url text NOT NULL CHECK (length(callback_url) BETWEEN 16 AND 2048),
  callback_generation bigint NOT NULL CHECK (callback_generation > 0),
  secret_ciphertext text NOT NULL CHECK (length(secret_ciphertext) > 0),
  kind text NOT NULL CHECK (kind ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  payload jsonb NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  claimed_at timestamptz,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (terminal_id, event_id),
  CHECK (delivered_at IS NULL OR dead_lettered_at IS NULL)
);

CREATE INDEX IF NOT EXISTS terminal_callback_delivery_pending
  ON terminal_callback_deliveries (available_at, created_at)
  WHERE delivered_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX IF NOT EXISTS terminal_callback_delivery_retention
  ON terminal_callback_deliveries (created_at);
