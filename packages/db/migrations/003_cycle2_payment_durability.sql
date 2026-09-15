-- Cycle-2 payment durability and bounded retention.
ALTER TABLE stripe_events DROP CONSTRAINT IF EXISTS stripe_events_processing_status_check;
UPDATE stripe_events SET processing_status=CASE processing_status WHEN 'PROCESSED' THEN 'COMPLETE' WHEN 'IGNORED' THEN 'COMPLETE' WHEN 'RECEIVED' THEN 'FAILED' ELSE processing_status END;
ALTER TABLE stripe_events ADD CONSTRAINT stripe_events_processing_status_check CHECK(processing_status IN ('PROCESSING','COMPLETE','MANUAL_REVIEW','FAILED'));
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0);
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE stripe_events ADD COLUMN IF NOT EXISTS payload jsonb;
CREATE INDEX IF NOT EXISTS stripe_events_review_queue ON stripe_events(processing_status,updated_at) WHERE processing_status IN ('FAILED','MANUAL_REVIEW','PROCESSING');
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(window_start);
DELETE FROM rate_limits WHERE window_start < now()-interval '1 day';

CREATE TABLE IF NOT EXISTS provider_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK(kind IN ('STRIPE_REFUND')),
  state text NOT NULL CHECK(state IN ('QUEUED','PROCESSING','SUCCEEDED','FAILED','RESOLVED')),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  stripe_event_id text REFERENCES stripe_events(event_id),
  idempotency_key text NOT NULL UNIQUE,
  provider_reference text NOT NULL,
  provider_action_id text,
  provider_status text,
  amount_minor int NOT NULL CHECK(amount_minor>0),
  attempts int NOT NULL DEFAULT 0 CHECK(attempts>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_error text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_actions_work ON provider_actions(available_at,created_at) WHERE state IN ('QUEUED','FAILED','PROCESSING');
CREATE TABLE IF NOT EXISTS payment_refunds (
  refund_id text PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  charge_id text,
  payment_intent_id text,
  amount_minor int NOT NULL CHECK(amount_minor>=0),
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_refunds_payment ON payment_refunds(payment_id,status);
ALTER TABLE terminal_payment_events ADD COLUMN IF NOT EXISTS resolution_kind text CHECK(resolution_kind IN ('START','EXTENSION','REJECT'));
