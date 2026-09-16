BEGIN;

ALTER TABLE terminal_payment_events
  DROP CONSTRAINT IF EXISTS terminal_payment_events_terminal_id_fkey;
ALTER TABLE terminal_payment_events
  ADD CONSTRAINT terminal_payment_events_terminal_id_fkey
  FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE;

ALTER TABLE terminal_outbound_events
  DROP CONSTRAINT IF EXISTS terminal_outbound_events_terminal_id_fkey;
ALTER TABLE terminal_outbound_events
  ADD CONSTRAINT terminal_outbound_events_terminal_id_fkey
  FOREIGN KEY (terminal_id) REFERENCES terminals(id) ON DELETE CASCADE;

DELETE FROM terminals WHERE enabled = false;

COMMIT;
