import { createHash } from "node:crypto";
import type { UserRole } from "@lake-tech/core";
import { assertPermission } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { cleanupExpiredPendingHolds } from "./checkout";

export type ReservationInput = {
  listingId: string;
  targetUserId: string;
  expiresAt: Date;
  notes: string;
  idempotencyKey: string;
};
export type ReservationResult = { id: string; replayed: boolean };

function canonicalReservation(input: ReservationInput) {
  return {
    listingId: input.listingId,
    targetUserId: input.targetUserId,
    expiresAt: input.expiresAt.toISOString(),
    notes: input.notes.trim(),
  };
}

export function reservationFingerprint(input: ReservationInput): string {
  const request = canonicalReservation(input);
  return createHash("sha256")
    .update(`${request.listingId}\n${request.targetUserId}\n${request.expiresAt}\n${request.notes}`)
    .digest("hex");
}

export async function createReservation(actorUserId: string, input: ReservationInput): Promise<ReservationResult> {
  const now = Date.now();
  if (input.expiresAt.getTime() <= now || input.expiresAt.getTime() > now + 7 * 24 * 60 * 60_000) {
    throw new Error("INVALID_EXPIRATION");
  }
  const canonical = canonicalReservation(input);
  const fingerprint = reservationFingerprint(input);

  return transaction(async (db) => {
    const initialActor = await db.query<{ role: UserRole; active: boolean }>(
      "SELECT role,active FROM users WHERE id=$1",
      [actorUserId],
    );
    if (!initialActor.rows[0]?.active) throw new Error("FORBIDDEN");
    assertPermission(initialActor.rows[0].role, "reservation:manage");

    // Lock the idempotency namespace before the listing. The actor is read above
    // without a row lock, then revalidated after listing/user-role locks.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `reservation-idempotency:${actorUserId}:${input.idempotencyKey}`,
    ]);
    const replay = await db.query<{ id: string; request_fingerprint: string }>(
      "SELECT id,request_fingerprint FROM reservations WHERE created_by_user_id=$1 AND idempotency_key=$2",
      [actorUserId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_fingerprint !== fingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
      return { id: replay.rows[0].id, replayed: true };
    }

    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`listing:${input.listingId}`]);
    for (const userId of [...new Set([actorUserId, input.targetUserId])].sort()) {
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user-role:${userId}`]);
    }
    const actor = await db.query<{ role: UserRole; active: boolean }>(
      "SELECT role,active FROM users WHERE id=$1 FOR UPDATE",
      [actorUserId],
    );
    if (!actor.rows[0]?.active) throw new Error("FORBIDDEN");
    assertPermission(actor.rows[0].role, "reservation:manage");
    await cleanupExpiredPendingHolds(db, input.listingId);
    await db.query(
      "UPDATE reservations SET status='EXPIRED' WHERE listing_id=$1 AND status='ACTIVE' AND expires_at<=now()",
      [input.listingId],
    );
    const target = await db.query<{ role: UserRole; active: boolean; verified: boolean }>(
      `SELECT u.role,u.active,(s.avatar_id IS NOT NULL) verified
       FROM users u LEFT JOIN sl_identities s ON s.user_id=u.id
       WHERE u.id=$1 FOR UPDATE OF u`,
      [input.targetUserId],
    );
    if (!target.rows[0]?.active || !target.rows[0].verified || !["RESIDENT", "RENTER", "ADMINISTRATOR"].includes(target.rows[0].role)) {
      throw new Error("NOT_FOUND");
    }
    if (actor.rows[0].role === "AGENT" && !["RESIDENT", "RENTER"].includes(target.rows[0].role)) {
      throw new Error("TARGET_ROLE_FORBIDDEN");
    }

    const listing = await db.query(
      `SELECT l.id FROM listings l JOIN pricing p ON p.listing_id=l.id AND p.active
       WHERE l.id=$1 AND l.published
       AND NOT EXISTS (SELECT 1 FROM rentals r WHERE r.listing_id=l.id AND r.status IN ('PENDING','ACTIVE') AND r.ends_at>now())
       AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.listing_id=l.id AND x.status='ACTIVE' AND x.expires_at>now())`,
      [input.listingId],
    );
    if (!listing.rowCount) throw new Error("UNAVAILABLE");

    const inserted = await db.query<{ id: string }>(
      `INSERT INTO reservations(
         listing_id,target_user_id,created_by_user_id,expires_at,notes,idempotency_key,request_fingerprint
       ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        canonical.listingId,
        canonical.targetUserId,
        actorUserId,
        canonical.expiresAt,
        canonical.notes,
        input.idempotencyKey,
        fingerprint,
      ],
    );
    await db.query(
      "INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,'RESERVATION_CREATED','RESERVATION',$2,$3::jsonb)",
      [actorUserId, inserted.rows[0]!.id, JSON.stringify(canonical)],
    );
    return { id: inserted.rows[0]!.id, replayed: false };
  });
}

export async function cancelReservation(actorUserId: string, reservationId: string, reason: string): Promise<void> {
  await transaction(async (db) => {
    const actor = await db.query<{ role: UserRole; active: boolean }>("SELECT role,active FROM users WHERE id=$1", [actorUserId]);
    if (!actor.rows[0]?.active) throw new Error("FORBIDDEN");
    assertPermission(actor.rows[0].role, "reservation:manage");
    const reservation = await db.query<{ created_by_user_id: string }>("SELECT created_by_user_id FROM reservations WHERE id=$1 AND status='ACTIVE' FOR UPDATE", [reservationId]);
    if (!reservation.rows[0]) throw new Error("NOT_FOUND");
    if (actor.rows[0].role === "AGENT" && reservation.rows[0].created_by_user_id !== actorUserId) throw new Error("FORBIDDEN");
    await db.query("UPDATE reservations SET status='CANCELLED',cancellation_reason=$2,cancelled_at=now() WHERE id=$1", [reservationId, reason]);
    await db.query("INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,'RESERVATION_CANCELLED','RESERVATION',$2,$3::jsonb)", [actorUserId, reservationId, JSON.stringify({ reason })]);
  });
}
