import { createTerminalCallbackEnvelope, openTerminalSecret } from "@lake-tech/core";

export type CallbackQueryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};
export type TerminalCallback = {
  id: string;
  event_id: string;
  callback_url: string;
  callback_generation: number;
  kind: string;
  payload: unknown;
  created_at: string | Date;
  secret_ciphertext: string;
  attempts: number;
  sequence: number;
};
export type CallbackTransaction = <T>(fn: (db: CallbackQueryable) => Promise<T>) => Promise<T>;
export type CallbackFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_ATTEMPTS = 8;
const LEASE_SECONDS = 120;
const MAX_BACKOFF_SECONDS = 300;

/** Claim one due callback and lease it; callers must deliver outside the transaction. */
export async function claimTerminalCallback(db: CallbackQueryable): Promise<TerminalCallback | null> {
  const found = await db.query<TerminalCallback>(`SELECT d.id::text,d.event_id,d.callback_url,d.callback_generation,d.kind,d.payload,d.sequence,d.created_at,d.attempts,d.secret_ciphertext
    FROM terminal_callback_deliveries d
    WHERE d.delivered_at IS NULL AND d.dead_lettered_at IS NULL AND d.available_at<=now()
      AND (d.claimed_at IS NULL OR d.claimed_at<now()-interval '${LEASE_SECONDS} seconds')
    ORDER BY d.available_at,d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`);
  const item = found.rows[0];
  if (!item) return null;
  if (item.attempts >= MAX_ATTEMPTS) {
    await db.query("UPDATE terminal_callback_deliveries SET dead_lettered_at=now(),claimed_at=NULL,last_error='attempts exhausted' WHERE id=$1 AND delivered_at IS NULL", [item.id]);
    return null;
  }
  const changed = await db.query("UPDATE terminal_callback_deliveries SET claimed_at=now(),attempts=attempts+1,last_error=NULL WHERE id=$1 AND delivered_at IS NULL AND dead_lettered_at IS NULL", [item.id]);
  return changed.rowCount === 1 ? item : null;
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.max(0, attempts - 1));
}

async function recordFailure(db: CallbackQueryable, item: TerminalCallback, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "callback delivery failed";
  await db.query(`UPDATE terminal_callback_deliveries
    SET claimed_at=NULL,available_at=now()+($2||' seconds')::interval,last_error=$3,
        dead_lettered_at=CASE WHEN attempts>=${MAX_ATTEMPTS} THEN now() ELSE dead_lettered_at END
    WHERE id=$1 AND delivered_at IS NULL`, [item.id, String(retryDelaySeconds(item.attempts + 1)), message]);
}

export async function runOneTerminalCallback(
  db: CallbackQueryable,
  item: TerminalCallback,
  secret: string,
  fetcher: CallbackFetcher = fetch,
): Promise<void> {
  try {
    const envelope = createTerminalCallbackEnvelope({ eventId: item.event_id, kind: item.kind, sequence: item.sequence, payload: item.payload, createdAt: new Date(item.created_at).toISOString() }, secret);
    const response = await fetcher(item.callback_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sl-event-id": item.event_id,
        "x-sl-callback-generation": String(item.callback_generation),
        "x-sl-callback-signature": envelope.signature,
      },
      body: envelope.body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`callback returned HTTP ${response.status}`);
    await db.query("UPDATE terminal_callback_deliveries SET delivered_at=now(),claimed_at=NULL,last_error=NULL WHERE id=$1 AND delivered_at IS NULL", [item.id]);
  } catch (error) {
    await recordFailure(db, item, error);
  }
}

export async function processOneTerminalCallback(tx: CallbackTransaction, encryptionKey: string, fetcher: CallbackFetcher = fetch): Promise<boolean> {
  const item = await tx(claimTerminalCallback);
  if (!item) return false;
  let secret: string;
  try {
    secret = openTerminalSecret(item.secret_ciphertext, encryptionKey);
  } catch (error) {
    await tx(db => recordFailure(db, item, error));
    return true;
  }
  const transactionalUpdates: CallbackQueryable = { query: (sql, values) => tx(db => db.query(sql, values)) };
  await runOneTerminalCallback(transactionalUpdates, item, secret, fetcher);
  return true;
}

export { MAX_ATTEMPTS, retryDelaySeconds };
