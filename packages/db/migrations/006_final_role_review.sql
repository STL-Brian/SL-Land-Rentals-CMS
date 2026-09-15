-- Final role-review hardening: bind reservation idempotency to semantics.
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS request_fingerprint char(64);

-- Rows created before request fingerprints existed remain replay-safe only for
-- their historical key. New service calls always persist the canonical digest.
UPDATE reservations
SET request_fingerprint = encode(digest(
  listing_id::text || E'\n' || target_user_id::text || E'\n' ||
  to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || E'\n' || notes,
  'sha256'
), 'hex')
WHERE request_fingerprint IS NULL;

ALTER TABLE reservations
  ALTER COLUMN request_fingerprint SET NOT NULL;
