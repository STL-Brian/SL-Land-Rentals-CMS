import { closePool, pool, transaction } from "@lake-tech/db";
import { processOneTerminalCallback } from "./terminal-callback-worker.js";

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.TERMINAL_SECRET_ENCRYPTION_KEY ?? process.env.OTP_HMAC_SECRET;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!encryptionKey || encryptionKey.length < 32) throw new Error("TERMINAL_SECRET_ENCRYPTION_KEY or OTP_HMAC_SECRET must have at least 32 characters");

let stopping = false;
const db = pool();
async function heartbeat(healthy: boolean, error: string | null = null): Promise<void> {
  await transaction(db => db.query(`INSERT INTO bot_health(worker_id,mode,adapter_connected,last_db_ok_at,heartbeat_at,last_error) VALUES('callback-worker','terminal-callback',$1,now(),now(),$2) ON CONFLICT(worker_id) DO UPDATE SET adapter_connected=$1,last_db_ok_at=now(),heartbeat_at=now(),last_error=$2`, [healthy, error]));
}
async function loop(): Promise<void> {
  while (!stopping) {
    try {
      const worked = await processOneTerminalCallback(transaction, encryptionKey!);
      await heartbeat(true);
      if (!worked) await new Promise(resolve => setTimeout(resolve, 1_000));
    } catch (error) {
      console.error("terminal callback worker failure", error instanceof Error ? error.message : error);
      await heartbeat(false, error instanceof Error ? error.message : "worker error").catch(() => undefined);
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }
}
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await db.query("DELETE FROM bot_health WHERE worker_id='callback-worker'").catch(() => undefined);
  await closePool();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
console.log("terminal callback worker ready");
await loop();
