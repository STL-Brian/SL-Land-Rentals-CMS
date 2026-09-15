import { closePool, transaction } from "@lake-tech/db";
import { processOneTerminalCallback } from "./terminal-callback-worker.js";

const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.TERMINAL_SECRET_ENCRYPTION_KEY ?? process.env.OTP_HMAC_SECRET;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!encryptionKey || encryptionKey.length < 32) throw new Error("TERMINAL_SECRET_ENCRYPTION_KEY or OTP_HMAC_SECRET must have at least 32 characters");

let stopping = false;
async function loop(): Promise<void> {
  while (!stopping) {
    try {
      const worked = await processOneTerminalCallback(transaction, encryptionKey!);
      if (!worked) await new Promise(resolve => setTimeout(resolve, 1_000));
    } catch (error) {
      console.error("terminal callback worker failure", error instanceof Error ? error.message : error);
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }
}
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await closePool();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
console.log("terminal callback worker ready");
await loop();
