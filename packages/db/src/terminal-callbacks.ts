import type pg from "pg";

export interface TerminalCallbackEnqueueInput {
  terminalId: string;
  eventId: string;
  callbackUrl: string;
  callbackGeneration: number;
  secretCiphertext: string;
  kind: string;
  payload: unknown;
  sequence: number;
}

/** Enqueue on the caller's transaction; never opens or commits a transaction. */
export async function enqueueTerminalCallback(
  client: Pick<pg.PoolClient, "query">,
  input: TerminalCallbackEnqueueInput,
): Promise<void> {
  if (!input.terminalId || !input.eventId || !input.secretCiphertext || !Number.isSafeInteger(input.callbackGeneration) || input.callbackGeneration < 1 || !Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new Error("invalid terminal callback delivery");
  }
  const url = new URL(input.callbackUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.toString().length > 2048) throw new Error("invalid terminal callback URL");
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(input.kind)) throw new Error("invalid terminal callback kind");
  const payload = JSON.stringify(input.payload);
  if (payload === undefined) throw new Error("invalid terminal callback payload");
  await client.query(
    `INSERT INTO terminal_callback_deliveries
       (terminal_id,event_id,callback_url,callback_generation,secret_ciphertext,kind,payload,sequence)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     ON CONFLICT (terminal_id,event_id) DO NOTHING`,
    [input.terminalId, input.eventId, url.toString(), input.callbackGeneration, input.secretCiphertext, input.kind, payload, input.sequence],
  );
}
