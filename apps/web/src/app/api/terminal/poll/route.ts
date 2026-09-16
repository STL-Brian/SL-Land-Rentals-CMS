import { NextResponse } from "next/server";
import { assertFreshTimestamp, openTerminalSecret, verifyTerminalSignature } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { env } from "../../../../lib/env";

function header(req: Request, name: string): string {
  return req.headers.get(name) ?? "";
}

export async function GET(req: Request) {
  const cfg = env();
  const url = new URL(req.url);
  const body = "";
  const timestamp = header(req, "x-sl-timestamp");
  const nonce = header(req, "x-sl-nonce");
  const eventId = header(req, "x-sl-event-id");
  const objectId = header(req, "x-sl-object-id");
  const ownerId = header(req, "x-sl-owner-id");
  const shard = header(req, "x-sl-shard");
  const signature = header(req, "x-sl-signature");

  try {
    assertFreshTimestamp(timestamp);
    const sequence = Number(url.searchParams.get("sequence") ?? "0");
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("invalid sequence");

    const data = await transaction(async (db) => {
      const terminalResult = await db.query<{ id: string; secret_ciphertext: string; listing_id: string }>(
        `SELECT id,secret_ciphertext,listing_id FROM terminals
         WHERE object_id=$1 AND owner_id=$2 AND shard=$3 AND enabled
         FOR UPDATE`,
        [objectId, ownerId, shard],
      );
      const terminal = terminalResult.rows[0];
      if (!terminal) throw new Error("terminal verification failed");
      const secret = openTerminalSecret(terminal.secret_ciphertext, cfg.terminalEncryptionKey);
      if (!verifyTerminalSignature({ timestamp, nonce, eventId, body }, secret, signature)) throw new Error("terminal verification failed");

      const nonceResult = await db.query(
        "INSERT INTO terminal_nonces(terminal_id,nonce) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
        [terminal.id, nonce],
      );
      if (!nonceResult.rowCount) throw new Error("terminal replay");
      await db.query("DELETE FROM terminal_nonces WHERE seen_at<now()-interval '7 days'");
      await db.query("DELETE FROM terminal_outbound_events WHERE created_at<now()-interval '30 days'");
      await db.query("UPDATE terminals SET last_seen_at=now() WHERE id=$1", [terminal.id]);
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`listing:${terminal.listing_id}`]);
      await db.query("UPDATE rentals SET status='ENDED' WHERE listing_id=$1 AND status='ACTIVE' AND ends_at<=now()", [terminal.listing_id]);
      await db.query("UPDATE reservations SET status='EXPIRED' WHERE listing_id=$1 AND status='ACTIVE' AND expires_at<=now()", [terminal.listing_id]);

      const rental = await db.query<{ listing_name: string; display_name: string | null; ends_epoch: string | null; weekly_linden: number; setup_linden: number; prims: number; reserved_id: string | null }>(
        `SELECT l.name AS listing_name,u.display_name,extract(epoch from r.ends_at)::bigint::text AS ends_epoch,
                p.weekly_linden,p.setup_linden,l.prims,x.id reserved_id
         FROM pricing p
         JOIN listings l ON l.id=p.listing_id
         LEFT JOIN rentals r ON r.listing_id=p.listing_id AND r.status='ACTIVE' AND r.ends_at>now()
         LEFT JOIN users u ON u.id=r.user_id
         LEFT JOIN reservations x ON x.listing_id=p.listing_id AND x.status='ACTIVE' AND x.expires_at>now()
         WHERE p.listing_id=$1 AND p.active`,
        [terminal.listing_id],
      );
      const events = await db.query<{ id: string; kind: string; payload: unknown }>(
        "SELECT id::text,kind,payload FROM terminal_outbound_events WHERE terminal_id=$1 AND id>$2 ORDER BY id LIMIT 20",
        [terminal.id, sequence],
      );
      const current = rental.rows[0];
      const payPrices = current && !current.reserved_id
        ? [1, 2, 3, 4].map(weeks => current.weekly_linden * weeks + (current.ends_epoch ? 0 : current.setup_linden))
        : [0, 0, 0, 0];
      const healthChecks = events.rows.filter(event => event.kind === "HEALTH_CHECK").map(event => {
        const payload = event.payload as { checkId?: unknown };
        return typeof payload.checkId === "string" ? payload.checkId : null;
      }).filter((checkId): checkId is string => checkId !== null);
      return {
        sequence: events.rows.at(-1)?.id ?? String(sequence),
        rentalName: current?.listing_name ?? "Rental terminal",
        prims: current?.prims ?? 0,
        renter: current?.display_name ?? null,
        endsAt: current?.ends_epoch ?? null,
        payPrice: payPrices[0] ?? 0,
        payPrices,
        healthChecks,
        events: events.rows,
      };
    });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Terminal request rejected" }, { status: 401 });
  }
}
