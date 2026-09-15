import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, query, transaction } from "@lake-tech/db";
import { changeUserRole } from "./role-management.js";
import { cancelReservation, createReservation } from "./reservations.js";
import { createCheckoutHold, settleCheckoutInvoice } from "./checkout.js";

const enabled = Boolean(process.env.DATABASE_URL);
const run = enabled ? it : it.skip;
const ids = {
  admin: crypto.randomUUID(), secondAdmin: crypto.randomUUID(), manager: crypto.randomUUID(),
  agent: crypto.randomUUID(), resident: crypto.randomUUID(), listing: crypto.randomUUID(), property: crypto.randomUUID(),
};

beforeAll(async () => {
  if (!enabled) return;
  await query(`INSERT INTO users(id,role,display_name) VALUES
    ($1,'ADMINISTRATOR','RBAC admin'),($2,'ADMINISTRATOR','RBAC second admin'),
    ($3,'MANAGER','RBAC manager'),($4,'AGENT','RBAC agent'),($5,'RESIDENT','RBAC resident')`,
    [ids.admin, ids.secondAdmin, ids.manager, ids.agent, ids.resident]);
  await query("INSERT INTO properties(id,name,region_name) VALUES($1,'RBAC property','RBAC region')", [ids.property]);
  await query(`INSERT INTO listings(id,property_id,slug,name,kind,description,area_sqm,prims,published)
    VALUES($1,$2,$3,'RBAC listing','PARCEL','Integration test listing for reservations',1024,250,true)`,
    [ids.listing, ids.property, `rbac-${ids.listing}`]);
  await query("INSERT INTO pricing(listing_id,weekly_linden,stripe_weekly_minor) VALUES($1,1000,500)", [ids.listing]);
});

afterAll(async () => {
  if (!enabled) return;
  await query("DELETE FROM audit_log WHERE actor_user_id = ANY($1::uuid[]) OR target_id = ANY($2::text[])", [[ids.admin, ids.secondAdmin, ids.manager, ids.agent], [ids.resident, ids.listing]]);
  await query("DELETE FROM reservations WHERE listing_id=$1", [ids.listing]);
  await query("DELETE FROM pricing WHERE listing_id=$1", [ids.listing]);
  await query("DELETE FROM listings WHERE id=$1", [ids.listing]);
  await query("DELETE FROM properties WHERE id=$1", [ids.property]);
  await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ids.admin, ids.secondAdmin, ids.manager, ids.agent, ids.resident]]);
  await pool().end();
});

describe("PostgreSQL role mutation", () => {
  run("revokes sessions and refuses demoting the last active administrator", async () => {
    await query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')", [ids.secondAdmin, "a".repeat(64)]);
    await changeUserRole(ids.admin, ids.secondAdmin, "MANAGER", "Operational handoff");
    expect((await query<{ role: string }>("SELECT role FROM users WHERE id=$1", [ids.secondAdmin])).rows[0]?.role).toBe("MANAGER");
    expect((await query("SELECT 1 FROM sessions WHERE user_id=$1", [ids.secondAdmin])).rowCount).toBe(0);
    const disabled = await query<{ id: string }>("UPDATE users SET active=false WHERE role='ADMINISTRATOR' AND id<>$1 RETURNING id", [ids.admin]);
    try {
      await expect(changeUserRole(ids.admin, ids.admin, "MANAGER", "Would remove final administrator")).rejects.toThrow("LAST_ADMINISTRATOR");
    } finally {
      if (disabled.rowCount) await query("UPDATE users SET active=true WHERE id = ANY($1::uuid[])", [disabled.rows.map((row) => row.id)]);
    }
  });

  run("serializes concurrent attempts to demote every active administrator", async () => {
    await query("UPDATE users SET role='ADMINISTRATOR',active=true WHERE id = ANY($1::uuid[])", [[ids.admin, ids.secondAdmin]]);
    const before=Number((await query<{count:string}>("SELECT count(*)::text count FROM users WHERE role='ADMINISTRATOR' AND active")).rows[0]?.count);
    const outcomes=await Promise.allSettled([
      changeUserRole(ids.admin,ids.admin,"MANAGER","Concurrent administrator handoff A"),
      changeUserRole(ids.secondAdmin,ids.secondAdmin,"MANAGER","Concurrent administrator handoff B"),
    ]);
    const fulfilled=outcomes.filter(result=>result.status==="fulfilled").length;
    const after=Number((await query<{count:string}>("SELECT count(*)::text count FROM users WHERE role='ADMINISTRATOR' AND active")).rows[0]?.count);
    expect(fulfilled).toBe(Math.min(2,before-1));
    expect(after).toBe(before-fulfilled);
    expect(after).toBeGreaterThanOrEqual(1);
    await query("UPDATE users SET role='ADMINISTRATOR' WHERE id = ANY($1::uuid[])", [[ids.admin,ids.secondAdmin]]);
  });
});

describe("PostgreSQL staff reservations", () => {
  run("binds idempotency keys to one request and converges concurrent identical calls", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const input = { listingId: ids.listing, targetUserId: ids.resident, expiresAt, notes: "Concierge request", idempotencyKey: "integration-reservation" };
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const call = async () => { await barrier; return createReservation(ids.agent, input); };
    const firstCall = call();
    const replayCall = call();
    release();
    const [first, replay] = await Promise.all([firstCall, replayCall]);
    expect(replay.id).toBe(first.id);
    expect((await query<{ role: string }>("SELECT role FROM users WHERE id=$1", [ids.resident])).rows[0]?.role).toBe("RESIDENT");
    await expect(createReservation(ids.agent, { ...input, notes: "Different semantic request" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(createReservation(ids.manager, { ...input, idempotencyKey: "concurrent-manager" })).rejects.toThrow("UNAVAILABLE");
    await cancelReservation(ids.agent, first.id, "Customer changed plans");
    expect((await query<{ status: string }>("SELECT status FROM reservations WHERE id=$1", [first.id])).rows[0]?.status).toBe("CANCELLED");
  });

  run("rejects unauthorized roles plus active rentals and checkout holds", async () => {
    await expect(createReservation(ids.resident, { listingId: ids.listing, targetUserId: ids.resident, expiresAt: new Date(Date.now()+3*60*60_000), notes: "", idempotencyKey: "resident-bypass" })).rejects.toThrow("FORBIDDEN");
    const input={listingId:ids.listing,targetUserId:ids.resident,expiresAt:new Date(Date.now()+60*60_000),notes:"Conflict test"};
    const active=await query<{id:string}>("INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'ACTIVE',now(),now()+interval '1 week') RETURNING id",[ids.listing,ids.resident]);
    await expect(createReservation(ids.agent,{...input,idempotencyKey:"blocked-active-rental"})).rejects.toThrow("UNAVAILABLE");
    await query("DELETE FROM rentals WHERE id=$1",[active.rows[0]!.id]);
    const hold=await query<{id:string}>("INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'PENDING',now(),now()+interval '32 minutes') RETURNING id",[ids.listing,ids.resident]);
    await expect(createReservation(ids.agent,{...input,idempotencyKey:"blocked-checkout-hold"})).rejects.toThrow("UNAVAILABLE");
    await query("DELETE FROM rentals WHERE id=$1",[hold.rows[0]!.id]);
  });

  run("prevents an agent from targeting staff through the authoritative service", async () => {
    const base = { listingId: ids.listing, expiresAt: new Date(Date.now()+60*60_000), notes: "Direct service bypass" };
    for (const targetUserId of [ids.admin, ids.manager, ids.agent]) {
      await expect(createReservation(ids.agent, {
        ...base,
        targetUserId,
        idempotencyKey: `staff-target-${targetUserId}`,
      })).rejects.toThrow("TARGET_ROLE_FORBIDDEN");
    }
  });

  run("serializes concurrent reservations and prevents agents cancelling another creator's reservation", async()=>{
    const input={listingId:ids.listing,targetUserId:ids.resident,expiresAt:new Date(Date.now()+60*60_000),notes:"Concurrent request"};
    const outcomes=await Promise.allSettled([
      createReservation(ids.agent,{...input,idempotencyKey:"parallel-agent"}),
      createReservation(ids.manager,{...input,idempotencyKey:"parallel-manager"}),
    ]);
    expect(outcomes.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    const live=await query<{id:string;created_by_user_id:string}>("SELECT id,created_by_user_id FROM reservations WHERE listing_id=$1 AND status='ACTIVE'",[ids.listing]);
    expect(live.rowCount).toBe(1);
    if(live.rows[0]!.created_by_user_id===ids.manager){
      await expect(cancelReservation(ids.agent,live.rows[0]!.id,"Not the creating agent")).rejects.toThrow("FORBIDDEN");
    }
    await cancelReservation(ids.manager,live.rows[0]!.id,"Concurrency test cleanup");
  });
});

describe("active-rental role invariant", () => {
  run("does not deadlock administrator reservation creation against checkout", async () => {
    await query("DELETE FROM reservations WHERE listing_id=$1", [ids.listing]);
    const checkout = await pool().connect();
    const key = `reservation-checkout-race-${crypto.randomUUID()}`;
    let hold: { invoiceId: string; rentalId: string } | undefined;
    let holdError: unknown;
    try {
      await checkout.query("BEGIN");
      await checkout.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`listing:${ids.listing}`]);
      let reservationSettled = false;
      const reservation = createReservation(ids.admin, {
        listingId: ids.listing,
        targetUserId: ids.resident,
        expiresAt: new Date(Date.now() + 60 * 60_000),
        notes: "Checkout lock-order race",
        idempotencyKey: key,
      }).then((value) => ({ value, error: undefined as unknown })).catch((error: unknown) => ({ value: undefined, error })).finally(() => { reservationSettled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(reservationSettled).toBe(false);
      try { hold = await createCheckoutHold(checkout, ids.listing, ids.admin); await checkout.query("COMMIT"); }
      catch (error) { holdError = error; await checkout.query("ROLLBACK"); }
      const reservationResult = await reservation;
      const errors = [holdError, reservationResult.error].filter(Boolean) as Array<Error & { code?: string }>;
      expect(errors.some((error) => error.code === "40P01" || /deadlock/i.test(error.message))).toBe(false);
      expect(hold).toBeDefined();
      expect(reservationResult.error).toBeInstanceOf(Error);
      expect((reservationResult.error as Error).message).toBe("UNAVAILABLE");
    } finally {
      checkout.release();
      if (hold) {
        await query("DELETE FROM invoices WHERE id=$1", [hold.invoiceId]);
        await query("DELETE FROM rentals WHERE id=$1", [hold.rentalId]);
      }
      await query("DELETE FROM reservations WHERE created_by_user_id=$1 AND idempotency_key=$2", [ids.admin, key]);
    }
  });

  run("rejects demotion without revoking sessions or writing an audit entry", async () => {
    await query("UPDATE users SET role='RENTER' WHERE id=$1", [ids.resident]);
    const rental = await query<{ id: string }>(
      "INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'ACTIVE',now(),now()+interval '1 week') RETURNING id",
      [ids.listing, ids.resident],
    );
    const token = "b".repeat(64);
    await query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')", [ids.resident, token]);
    const before = Number((await query<{ n: string }>("SELECT count(*)::text n FROM audit_log WHERE target_id=$1", [ids.resident])).rows[0]?.n);
    await expect(changeUserRole(ids.admin, ids.resident, "RESIDENT", "Invalid active-rental demotion")).rejects.toThrow("ACTIVE_RENTAL_ROLE_CONFLICT");
    expect((await query<{ role: string }>("SELECT role FROM users WHERE id=$1", [ids.resident])).rows[0]?.role).toBe("RENTER");
    expect((await query("SELECT 1 FROM sessions WHERE user_id=$1 AND token_hash=$2", [ids.resident, token])).rowCount).toBe(1);
    expect(Number((await query<{ n: string }>("SELECT count(*)::text n FROM audit_log WHERE target_id=$1", [ids.resident])).rows[0]?.n)).toBe(before);
    await query("DELETE FROM rentals WHERE id=$1", [rental.rows[0]!.id]);
  });

  run("rejects role changes while a checkout hold is pending", async () => {
    await query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1", [ids.resident]);
    const rental = await query<{ id: string }>(
      "INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'PENDING',now(),now()+interval '30 minutes') RETURNING id",
      [ids.listing, ids.resident],
    );
    await expect(changeUserRole(ids.admin, ids.resident, "MANAGER", "Pending hold conflict")).rejects.toThrow("ACTIVE_RENTAL_ROLE_CONFLICT");
    expect((await query<{ role: string }>("SELECT role FROM users WHERE id=$1", [ids.resident])).rows[0]?.role).toBe("RESIDENT");
    await query("DELETE FROM rentals WHERE id=$1", [rental.rows[0]!.id]);
  });

  run("database rejects inactive, manager, and agent owners at activation", async () => {
    for (const state of [
      { active: false, role: "RESIDENT" },
      { active: true, role: "MANAGER" },
      { active: true, role: "AGENT" },
    ]) {
      await query("UPDATE users SET active=$2,role=$3::user_role WHERE id=$1", [ids.resident, state.active, state.role]);
      await expect(query(
        "INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'ACTIVE',now(),now()+interval '1 week')",
        [ids.listing, ids.resident],
      )).rejects.toThrow("RENTAL_USER_INELIGIBLE");
    }
    await query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1", [ids.resident]);
  });

  run("serializes checkout-hold insertion against a direct role mutation", async () => {
    await query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1", [ids.resident]);
    const creator = await pool().connect();
    const mutator = await pool().connect();
    const rentalId = crypto.randomUUID();
    try {
      await creator.query("BEGIN");
      await mutator.query("BEGIN");
      await creator.query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'PENDING',now(),now()+interval '30 minutes')", [rentalId, ids.listing, ids.resident]);
      let settled = false;
      const mutation = mutator.query("UPDATE users SET role='MANAGER' WHERE id=$1", [ids.resident]).finally(() => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const blockedByRentalInsert = !settled;
      await creator.query("COMMIT");
      let mutationRejected = false;
      try { await mutation; await mutator.query("COMMIT"); }
      catch { mutationRejected = true; await mutator.query("ROLLBACK"); }
      const violation = await query("SELECT 1 FROM rentals r JOIN users u ON u.id=r.user_id WHERE r.id=$1 AND r.status='PENDING' AND (NOT u.active OR u.role NOT IN ('RESIDENT','RENTER','ADMINISTRATOR'))", [rentalId]);
      await query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1", [ids.resident]);
      await query("DELETE FROM rentals WHERE id=$1", [rentalId]);
      expect(blockedByRentalInsert).toBe(true);
      expect(mutationRejected).toBe(true);
      expect(violation.rowCount).toBe(0);
    } finally {
      creator.release();
      mutator.release();
    }
  });

  run("serializes a role mutation racing checkout settlement", async () => {
    await query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1", [ids.resident]);
    const rental = await query<{ id: string }>("INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'PENDING',now(),now()+interval '30 minutes') RETURNING id", [ids.listing, ids.resident]);
    const invoice = await query<{ id: string }>("INSERT INTO invoices(rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'OPEN',500,'usd',now()+interval '30 minutes') RETURNING id", [rental.rows[0]!.id, ids.listing, ids.resident]);
    const outcomes = await Promise.allSettled([
      transaction((db) => settleCheckoutInvoice(db, { invoiceId: invoice.rows[0]!.id, provider: "SIMULATION", providerReference: `race-${invoice.rows[0]!.id}`, amountMinor: 500, currency: "usd" })),
      changeUserRole(ids.admin, ids.resident, "MANAGER", "Concurrent settlement race"),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const violation = await query("SELECT 1 FROM rentals r JOIN users u ON u.id=r.user_id WHERE r.id=$1 AND r.status='ACTIVE' AND (NOT u.active OR u.role NOT IN ('RESIDENT','RENTER','ADMINISTRATOR'))", [rental.rows[0]!.id]);
    expect(violation.rowCount).toBe(0);
    await query("DELETE FROM payments WHERE invoice_id=$1", [invoice.rows[0]!.id]);
    await query("DELETE FROM invoices WHERE id=$1", [invoice.rows[0]!.id]);
    await query("DELETE FROM rentals WHERE id=$1", [rental.rows[0]!.id]);
    await query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1", [ids.resident]);
  });
});
