import { NextResponse } from "next/server";
import { assertFreshTimestamp, openTerminalSecret, verifyTerminalSignature } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { env } from "../../../../lib/env";

export async function POST(req: Request) {
  const cfg = env();
  const body = await req.text();
  const header = (name: string) => req.headers.get(name) ?? "";
  try {
    const timestamp = header("x-sl-timestamp"); const nonce = header("x-sl-nonce"); const eventId = header("x-sl-event-id");
    if (!nonce || !eventId) throw new Error("missing terminal headers");
    assertFreshTimestamp(timestamp);
    const data = JSON.parse(body) as { checkId?: unknown };
    if (typeof data.checkId !== "string" || data.checkId.length > 100) throw new Error("invalid check id");
    await transaction(async db => {
      const found = await db.query<{ id: string; secret_ciphertext: string; health_check_id: string | null }>("SELECT id,secret_ciphertext,health_check_id FROM terminals WHERE object_id=$1 AND owner_id=$2 AND shard=$3 AND enabled FOR UPDATE", [header("x-sl-object-id"), header("x-sl-owner-id"), header("x-sl-shard")]);
      const terminal = found.rows[0]; if (!terminal) throw new Error("terminal verification failed");
      const secret = openTerminalSecret(terminal.secret_ciphertext, cfg.terminalEncryptionKey);
      if (!verifyTerminalSignature({ timestamp, nonce, eventId, body }, secret, header("x-sl-signature"))) throw new Error("terminal verification failed");
      const nonceResult = await db.query("INSERT INTO terminal_nonces(terminal_id,nonce) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING nonce", [terminal.id, nonce]);
      if (!nonceResult.rowCount) throw new Error("terminal replay");
      if (terminal.health_check_id !== data.checkId) throw new Error("unknown health check");
      await db.query("UPDATE terminals SET last_seen_at=now(),health_status='HEALTHY',health_checked_at=now() WHERE id=$1 AND health_check_id=$2", [terminal.id, data.checkId]);
    });
    return NextResponse.json({ accepted: true });
  } catch { return NextResponse.json({ error: "Terminal request rejected" }, { status: 401 }); }
}
