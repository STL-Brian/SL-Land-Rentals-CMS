import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { currentViewer } from "../../../../../lib/auth";
import { env } from "../../../../../lib/env";
import { assertBrowserOrigin, noStoreHeaders } from "../../../../../lib/http";
import { cleanupExpiredPendingHolds } from "../../../../../lib/checkout";
import { lockPaymentForReconciliation, retryProviderAction, retryStripeEvent, resolveProviderAction, resolveStripeEvent } from "../../../../../lib/reconciliation";
import { assertEligibleRentalUser } from "../../../../../lib/rental-eligibility";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("APPROVE"),
    note: z.string().trim().min(3).max(1000),
    rentalAction: z.enum(["START", "EXTENSION"]),
  }),
  z.object({
    action: z.literal("REJECT"),
    note: z.string().trim().min(3).max(1000),
  }),
  z.object({
    action: z.literal("RESOLVE_IDENTITY"),
    note: z.string().trim().min(3).max(1000),
    canonicalUsername: z.string().trim().min(3).max(63),
    displayName: z.string().trim().min(1).max(128),
  }),
  z.object({
    action: z.literal("RETRY"),
    note: z.string().trim().min(3).max(1000),
  }),
  z.object({
    action: z.literal("RESOLVE"),
    note: z.string().trim().min(3).max(1000),
  }),
]);
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertBrowserOrigin(req.headers, env().baseUrl);
  } catch {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!can(viewer.role, "payment:reconcile"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid reconciliation action" },
      { status: 400 },
    );
  let id = decodeURIComponent((await params).id);
  if (viewer.role === "MANAGER" && (id.startsWith("provider-action:") || id.startsWith("stripe-event:") || id.startsWith("stripe-payment:") || parsed.data.action === "RESOLVE_IDENTITY")) {
    return NextResponse.json({ error: "Administrator approval required" }, { status: 403 });
  }
  const result = "DONE";
  try {
    await transaction(async (db) => {
      if (id.startsWith("provider-action:")) {
        const actionId = id.slice(16);
        if (parsed.data.action === "RETRY")
          await retryProviderAction(db, actionId, viewer.id, parsed.data.note);
        else if (parsed.data.action === "RESOLVE")
          await resolveProviderAction(db, actionId, viewer.id, parsed.data.note);
        else throw new Error("INVALID");
        return;
      }
      if (id.startsWith("stripe-event:")) {
        const eventId = id.slice(13);
        if (parsed.data.action === "RETRY")
          await retryStripeEvent(db, eventId, viewer.id, parsed.data.note);
        else if (parsed.data.action === "RESOLVE")
          await resolveStripeEvent(db, eventId, viewer.id, parsed.data.note);
        else throw new Error("INVALID");
        return;
      }
      const stripePayment = id.startsWith("stripe-payment:");
      if(stripePayment) id=id.slice(15);
      const composite = !stripePayment && id.includes(":") ? id.split(":", 2) : null;
      if (composite) {
        const [terminalId, eventId] = composite;
        const event = await db.query<{
          payment_id: string | null;
          payer_avatar_id: string;
          amount_linden: number;
          expected_amount_linden: number;
          listing_id: string;
        }>(
          "SELECT e.payment_id,e.payer_avatar_id,e.amount_linden,e.expected_amount_linden,t.listing_id FROM terminal_payment_events e JOIN terminals t ON t.id=e.terminal_id WHERE e.terminal_id=$1 AND e.event_id=$2 AND e.status='MANUAL_REVIEW' FOR UPDATE OF e,t",
          [terminalId, eventId],
        );
        if (!event.rowCount) throw new Error("MISSING");
        const e = event.rows[0]!;
        if (!e.payment_id) {
          if (parsed.data.action === "RESOLVE_IDENTITY") {
            const user = await db.query<{ id: string }>(
              "INSERT INTO users(display_name) VALUES($1) RETURNING id",
              [parsed.data.displayName],
            );
            await db.query(
              "INSERT INTO sl_identities(avatar_id,user_id,canonical_username,display_name) VALUES($1,$2,$3,$4)",
              [
                e.payer_avatar_id,
                user.rows[0]!.id,
                parsed.data.canonicalUsername.toLowerCase(),
                parsed.data.displayName,
              ],
            );
            const invoice = await db.query<{ id: string }>(
              "INSERT INTO invoices(listing_id,user_id,status,amount_linden,due_at) VALUES($1,$2,'OPEN',$3,now()) RETURNING id",
              [e.listing_id, user.rows[0]!.id, e.expected_amount_linden],
            );
            const payment = await db.query<{ id: string }>(
              `INSERT INTO payments(invoice_id,provider,provider_reference,amount_linden,expected_amount_linden,status,reconciliation_note) VALUES($1,'LINDEN',$2,$3,$4,'MANUAL_REVIEW',$5) RETURNING id`,
              [
                invoice.rows[0]!.id,
                id,
                e.amount_linden,
                e.expected_amount_linden,
                parsed.data.note,
              ],
            );
            await db.query(
              "UPDATE terminal_payment_events SET payment_id=$3,resolution_note=$4 WHERE terminal_id=$1 AND event_id=$2",
              [terminalId, eventId, payment.rows[0]!.id, parsed.data.note],
            );
            await audit(
              db,
              viewer.id,
              "RECONCILIATION_IDENTITY_RESOLVED",
              id,
              parsed.data.note,
            );
            return;
          }
          if (parsed.data.action === "REJECT") {
            await db.query(
              "UPDATE terminal_payment_events SET status='FAILED',resolution_kind='REJECT',resolution_note=$3,resolved_by=$4,resolved_at=now() WHERE terminal_id=$1 AND event_id=$2",
              [terminalId, eventId, parsed.data.note, viewer.id],
            );
            return;
          }
          throw new Error("UNLINKED");
        }
        id = e.payment_id;
      }
      const paymentPreflight=await db.query<{listing_id:string;user_id:string}>("SELECT i.listing_id,i.user_id FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.id=$1",[id]);
      if(!paymentPreflight.rows[0])throw new Error("MISSING");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`listing:${paymentPreflight.rows[0].listing_id}`]);
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`user-role:${paymentPreflight.rows[0].user_id}`]);
      const p = await lockPaymentForReconciliation(db, id);
      if (parsed.data.action === "APPROVE") {
        if (p.provider !== "LINDEN") throw new Error("INVALID");
        await assertEligibleRentalUser(db, p.user_id);

        await db.query(
          "UPDATE reservations SET status='EXPIRED' WHERE listing_id=$1 AND status='ACTIVE' AND expires_at<=now()",
          [p.listing_id],
        );
        if (parsed.data.rentalAction === "START")
          await cleanupExpiredPendingHolds(db, p.listing_id);
        const reservation = await db.query<{ id: string; target_user_id: string }>(
          "SELECT id,target_user_id FROM reservations WHERE listing_id=$1 AND status='ACTIVE' AND expires_at>now() FOR UPDATE",
          [p.listing_id],
        );
        const active = await db.query<{ id: string; user_id: string }>(
          "SELECT id,user_id FROM rentals WHERE listing_id=$1 AND status='ACTIVE' AND ends_at>now() FOR UPDATE",
          [p.listing_id],
        );
        if (parsed.data.rentalAction === "START") {
          if (active.rowCount) throw new Error("STATE_CONFLICT");
          if (reservation.rows[0] && reservation.rows[0].target_user_id !== p.user_id) {
            throw new Error("RESERVATION_CONFLICT");
          }
          const rental = await db.query<{ id: string }>(
            "INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'ACTIVE',now(),now()+interval '1 week') ON CONFLICT DO NOTHING RETURNING id",
            [p.listing_id, p.user_id],
          );
          if (rental.rowCount !== 1) throw new Error("STATE_CONFLICT");
          await db.query("UPDATE users SET role='RENTER' WHERE id=$1 AND role='RESIDENT'", [p.user_id]);
          if (reservation.rows[0]) {
            const consumed = await db.query(
              "UPDATE reservations SET status='COMPLETED' WHERE id=$1 AND status='ACTIVE'",
              [reservation.rows[0].id],
            );
            if (consumed.rowCount !== 1) throw new Error("RESERVATION_CONFLICT");
          }
          const invoice = await db.query(
            "UPDATE invoices SET rental_id=$2,status='PAID' WHERE id=$1 AND status='OPEN'",
            [p.invoice_id, rental.rows[0]!.id],
          );
          if (invoice.rowCount !== 1) throw new Error("STATE_CONFLICT");
        } else {
          if (reservation.rows[0]) throw new Error("RESERVATION_CONFLICT");
          if (active.rows[0]?.user_id !== p.user_id)
            throw new Error("STATE_CONFLICT");
          const rental = await db.query(
            "UPDATE rentals SET ends_at=ends_at+interval '1 week' WHERE id=$1 AND status='ACTIVE'",
            [active.rows[0]!.id],
          );
          const invoice = await db.query(
            "UPDATE invoices SET rental_id=$2,status='PAID' WHERE id=$1 AND status='OPEN'",
            [p.invoice_id, active.rows[0]!.id],
          );
          if (rental.rowCount !== 1 || invoice.rowCount !== 1)
            throw new Error("STATE_CONFLICT");
          await db.query("UPDATE users SET role='RENTER' WHERE id=$1 AND role='RESIDENT'", [p.user_id]);
        }
        const payment = await db.query(
          "UPDATE payments SET status='CONFIRMED',reconciliation_note=$2 WHERE id=$1 AND status='MANUAL_REVIEW'",
          [id, parsed.data.note],
        );
        if (payment.rowCount !== 1) throw new Error("STATE_CONFLICT");
        await db.query(
          "UPDATE terminal_payment_events SET status='CONFIRMED',resolution_kind=$2,resolution_note=$3,resolved_by=$4,resolved_at=now() WHERE payment_id=$1",
          [id, parsed.data.rentalAction, parsed.data.note, viewer.id],
        );
      } else if (parsed.data.action === "RESOLVE" && stripePayment && p.provider === "STRIPE") {
        const payment=await db.query("UPDATE payments SET status='FAILED',reconciliation_note=$2 WHERE id=$1 AND status='MANUAL_REVIEW'",[id,parsed.data.note]);
        if(payment.rowCount!==1)throw new Error("STATE_CONFLICT");
      } else if (parsed.data.action === "REJECT") {
        const payment = await db.query(
          "UPDATE payments SET status='FAILED',reconciliation_note=$2 WHERE id=$1 AND status='MANUAL_REVIEW'",
          [id, parsed.data.note],
        );
        if (payment.rowCount !== 1) throw new Error("STATE_CONFLICT");
        await db.query(
          "UPDATE invoices SET status='VOID' WHERE id=$1 AND status='OPEN'",
          [p.invoice_id],
        );
        await db.query(
          "UPDATE terminal_payment_events SET status='FAILED',resolution_kind='REJECT',resolution_note=$2,resolved_by=$3,resolved_at=now() WHERE payment_id=$1",
          [id, parsed.data.note, viewer.id],
        );
      } else throw new Error("INVALID");
      await audit(
        db,
        viewer.id,
        `RECONCILIATION_${parsed.data.action}`,
        id,
        parsed.data.note,
      );
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    const messages: Record<string, string> = {
      MISSING: "Review item not found",
      UNLINKED: "Resolve the payer identity before approval",
      REFUND_ACTIVE:
        "Resolve the automatic refund action before changing this payment",
      STATE_CONFLICT:
        "Item state changed; refresh before retrying",
      RESERVATION_CONFLICT:
        "This property is reserved for another account",
      RENTAL_USER_INELIGIBLE:
        "The payer account is inactive or cannot hold a rental",
      NO_PAYLOAD: "Stored event cannot be retried",
      INVALID: "Action is not valid for this item",
    };
    return NextResponse.json(
      { error: messages[code] ?? "Resolution failed" },
      { status: code === "MISSING" ? 404 : 409 },
    );
  }
  return NextResponse.json(
    { resolved: result === "DONE" },
    { headers: noStoreHeaders },
  );
}
async function audit(
  db: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  actor: string,
  action: string,
  target: string,
  note: string,
) {
  await db.query(
    "INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,'RECONCILIATION',$3,$4::jsonb)",
    [actor, action, target, JSON.stringify({ note })],
  );
}
