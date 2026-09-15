import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { terminalPaymentSchema } from "@lake-tech/contracts";
import { assertFreshTimestamp, decideLindenPayment, openTerminalSecret, verifyTerminalSignature } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { env } from "../../../../lib/env";
import { cleanupExpiredPendingHolds } from "../../../../lib/checkout";
import { assertEligibleRentalUser } from "../../../../lib/rental-eligibility";

function header(req: Request, name: string): string {
  return req.headers.get(name) ?? "";
}

export async function POST(req: Request) {
  const cfg = env();
  const body = await req.text();
  const timestamp = header(req, "x-sl-timestamp");
  const nonce = header(req, "x-sl-nonce");
  const eventId = header(req, "x-sl-event-id");
  const objectId = header(req, "x-sl-object-id");
  const ownerId = header(req, "x-sl-owner-id");
  const shard = header(req, "x-sl-shard");
  const signature = header(req, "x-sl-signature");

  try {
    assertFreshTimestamp(timestamp);
    if (!nonce || !eventId || !objectId || !ownerId || !shard) throw new Error("missing terminal headers");
    const parsed = terminalPaymentSchema.parse(JSON.parse(body));
    const bodyHash = createHash("sha256").update(body).digest("hex");

    const result = await transaction(async (db) => {
      const terminalResult = await db.query<{ id: string; secret_ciphertext: string; listing_id: string }>(
        `SELECT id,secret_ciphertext,listing_id FROM terminals
         WHERE object_id=$1 AND owner_id=$2 AND shard=$3 AND enabled
         FOR UPDATE`,
        [objectId, ownerId, shard],
      );
      const terminal = terminalResult.rows[0];
      if (!terminal) throw new Error("terminal verification failed");
      const secret = openTerminalSecret(terminal.secret_ciphertext, cfg.terminalEncryptionKey);
      if (!verifyTerminalSignature({ timestamp, nonce, eventId, body }, secret, signature)) {
        throw new Error("terminal verification failed");
      }

      const prior = await db.query<{ status: "CONFIRMED" | "MANUAL_REVIEW"; payer_avatar_id: string; amount_linden: number; raw_body_sha256: string }>(
        "SELECT status,payer_avatar_id,amount_linden,raw_body_sha256 FROM terminal_payment_events WHERE terminal_id=$1 AND event_id=$2",
        [terminal.id, eventId],
      );
      if (prior.rowCount) {
        const existing = prior.rows[0]!;
        if (existing.raw_body_sha256 !== bodyHash || existing.payer_avatar_id !== parsed.payerAvatarId || existing.amount_linden !== parsed.amountLinden) {
          throw new Error("event ID payload conflict");
        }
        return { status: existing.status, idempotent: true };
      }

      const nonceResult = await db.query(
        "INSERT INTO terminal_nonces(terminal_id,nonce) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING nonce",
        [terminal.id, nonce],
      );
      if (!nonceResult.rowCount) throw new Error("terminal replay");
      // Indexed bounded retention; authenticated traffic performs cheap cleanup.
      await db.query("DELETE FROM terminal_nonces WHERE seen_at<now()-interval '7 days'");
      await db.query("DELETE FROM terminal_outbound_events WHERE created_at<now()-interval '30 days'");

      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`listing:${terminal.listing_id}`]);
      await db.query(
        "UPDATE rentals SET status='ENDED' WHERE listing_id=$1 AND status='ACTIVE' AND ends_at<=now()",
        [terminal.listing_id],
      );
      await cleanupExpiredPendingHolds(db, terminal.listing_id);
      await db.query(
        "UPDATE reservations SET status='EXPIRED' WHERE listing_id=$1 AND status='ACTIVE' AND expires_at<=now()",
        [terminal.listing_id],
      );
      const pricing = await db.query<{ weekly_linden: number; setup_linden: number }>(
        "SELECT weekly_linden,setup_linden FROM pricing WHERE listing_id=$1 AND active FOR UPDATE",
        [terminal.listing_id],
      );
      const rate = pricing.rows[0];
      if (!rate) throw new Error("terminal listing unavailable");

      const payer = await db.query<{ user_id: string; avatar_id: string }>(
        "SELECT user_id,avatar_id FROM sl_identities WHERE avatar_id=$1",
        [parsed.payerAvatarId],
      );
      let payerEligible = false;
      if(payer.rows[0]) {
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`user-role:${payer.rows[0].user_id}`]);
        try { await assertEligibleRentalUser(db, payer.rows[0].user_id); payerEligible = true; }
        catch { payerEligible = false; }
      }
      const reservation = await db.query<{ id: string; target_user_id: string }>(
        "SELECT id,target_user_id FROM reservations WHERE listing_id=$1 AND status='ACTIVE' AND expires_at>now() FOR UPDATE",
        [terminal.listing_id],
      );
      const active = await db.query<{ id: string; user_id: string; avatar_id: string }>(
        `SELECT r.id,r.user_id,sli.avatar_id
         FROM rentals r
         JOIN sl_identities sli ON sli.user_id=r.user_id
         WHERE r.listing_id=$1 AND r.status='ACTIVE' AND r.ends_at>now()
         FOR UPDATE OF r`,
        [terminal.listing_id],
      );

      const expected = rate.weekly_linden + (active.rowCount ? 0 : rate.setup_linden);
      let action = decideLindenPayment({
        received: parsed.amountLinden,
        expected,
        activeRenterAvatarId: active.rows[0]?.avatar_id ?? null,
        payerAvatarId: parsed.payerAvatarId,
        payerKnown: payer.rowCount === 1,
      });
      let rentalId = active.rows[0]?.id ?? null;
      const payerUserId = payer.rows[0]?.user_id ?? null;
      const liveReservation = reservation.rows[0];
      if (liveReservation && (active.rowCount || liveReservation.target_user_id !== payerUserId)) {
        action = "MANUAL_REVIEW";
      }
      if (payer.rowCount === 1 && !payerEligible) action = "MANUAL_REVIEW";

      if (action === "START") {
        const started = await db.query<{ id: string }>(
          `INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at)
           VALUES($1,$2,'ACTIVE',now(),now()+interval '1 week')
           ON CONFLICT DO NOTHING RETURNING id`,
          [terminal.listing_id, payerUserId],
        );
        rentalId = started.rows[0]?.id ?? null;
        if (!rentalId) {
          action = "MANUAL_REVIEW";
        } else {
          await db.query("UPDATE users SET role='RENTER' WHERE id=$1 AND role='RESIDENT'", [payerUserId]);
          if (liveReservation) {
            const consumed = await db.query(
              "UPDATE reservations SET status='COMPLETED' WHERE id=$1 AND status='ACTIVE'",
              [liveReservation.id],
            );
            if (consumed.rowCount !== 1) throw new Error("reservation consumption conflict");
          }
        }
      }

      const status = action === "MANUAL_REVIEW" ? "MANUAL_REVIEW" : "CONFIRMED";
      let paymentId: string | null = null;
      if (payerUserId) {
        const invoice = await db.query<{ id: string }>(
          `INSERT INTO invoices(rental_id,listing_id,user_id,status,amount_linden,due_at)
           VALUES($1,$2,$3,$4,$5,now()) RETURNING id`,
          [status === "CONFIRMED" ? rentalId : null, terminal.listing_id, payerUserId, status === "CONFIRMED" ? "PAID" : "OPEN", expected],
        );
        const payment = await db.query<{ id: string }>(
          `INSERT INTO payments(invoice_id,provider,provider_reference,amount_linden,expected_amount_linden,status)
           VALUES($1,'LINDEN',$2,$3,$4,$5) RETURNING id`,
          [invoice.rows[0]!.id, `${terminal.id}:${eventId}`, parsed.amountLinden, expected, status],
        );
        paymentId = payment.rows[0]!.id;
      }

      if (action === "EXTEND") {
        const extended = await db.query(
          "UPDATE rentals SET ends_at=ends_at+interval '1 week' WHERE id=$1 AND status='ACTIVE'",
          [rentalId],
        );
        if (extended.rowCount !== 1) throw new Error("rental extension conflict");
      }
      if (status === "CONFIRMED" && !paymentId) throw new Error("confirmed payment missing durable row");

      await db.query(
        `INSERT INTO terminal_payment_events(terminal_id,event_id,payer_avatar_id,amount_linden,expected_amount_linden,status,payment_id,raw_body_sha256)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [terminal.id, eventId, parsed.payerAvatarId, parsed.amountLinden, expected, status, paymentId, bodyHash],
      );
      await db.query(
        "INSERT INTO terminal_outbound_events(terminal_id,kind,payload) VALUES($1,'PAYMENT_RESULT',$2::jsonb)",
        [terminal.id, JSON.stringify({ eventId, status })],
      );
      return { status, idempotent: false };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("terminal payment rejected", error);
    return NextResponse.json({ error: "Terminal request rejected" }, { status: 401 });
  }
}
