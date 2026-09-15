import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, query, transaction } from "@lake-tech/db";
import { cleanupExpiredPendingHolds, createCheckoutHold, settleCheckoutInvoice } from "./checkout.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("reservation allocation invariant (PostgreSQL)", () => {
  const ids = {
    target: crypto.randomUUID(),
    other: crypto.randomUUID(),
    agent: crypto.randomUUID(),
    property: crypto.randomUUID(),
    listing: crypto.randomUUID(),
  };

  beforeAll(async () => {
    await query(
      "INSERT INTO users(id,display_name,role) VALUES($1,'Reserved target','RESIDENT'),($2,'Other payer','RESIDENT'),($3,'Reservation agent','AGENT')",
      [ids.target, ids.other, ids.agent],
    );
    await query("INSERT INTO properties(id,name,region_name) VALUES($1,'Reservation allocation','Reservation allocation')", [ids.property]);
    await query(
      "INSERT INTO listings(id,property_id,slug,name,kind,description,area_sqm,prims,published) VALUES($1,$2,$3,'Reserved parcel','PARCEL','Reservation allocation integration listing',512,100,true)",
      [ids.listing, ids.property, `reservation-allocation-${ids.listing}`],
    );
    await query("INSERT INTO pricing(listing_id,weekly_linden,setup_linden,stripe_weekly_minor,stripe_setup_minor) VALUES($1,1000,100,500,50)", [ids.listing]);
  });

  afterAll(async () => {
    await query("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE listing_id=$1)", [ids.listing]);
    await query("DELETE FROM invoices WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM rentals WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM reservations WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM pricing WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM listings WHERE id=$1", [ids.listing]);
    await query("DELETE FROM properties WHERE id=$1", [ids.property]);
    await query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ids.target, ids.other, ids.agent]]);
    await pool().end();
  });

  async function pendingInvoice(userId: string) {
    const rental = await query<{id:string}>(
      "INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'PENDING',now(),now()+interval '30 minutes') RETURNING id",
      [ids.listing, userId],
    );
    const invoice = await query<{id:string}>(
      "INSERT INTO invoices(rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'OPEN',550,'usd',now()+interval '30 minutes') RETURNING id",
      [rental.rows[0]!.id, ids.listing, userId],
    );
    return { rentalId: rental.rows[0]!.id, invoiceId: invoice.rows[0]!.id };
  }

  async function reserveTarget() {
    await query(
      "INSERT INTO reservations(listing_id,target_user_id,created_by_user_id,expires_at,notes,idempotency_key,request_fingerprint) VALUES($1,$2,$3,now()+interval '1 hour','allocation test',$4,$5)",
      [ids.listing, ids.target, ids.agent, crypto.randomUUID(), "f".repeat(64)],
    );
  }

  it("blocks legacy paid activation for a non-target", async () => {
    await reserveTarget();
    const hold = await pendingInvoice(ids.other);
    await expect(transaction((db) => settleCheckoutInvoice(db, {
      invoiceId: hold.invoiceId,
      provider: "SIMULATION",
      providerReference: `sim-${hold.invoiceId}`,
      amountMinor: 550,
      currency: "usd",
    }))).rejects.toThrow("RESERVATION_CONFLICT");
    expect((await query("SELECT status FROM rentals WHERE id=$1", [hold.rentalId])).rows[0]?.status).toBe("PENDING");
    await query("DELETE FROM invoices WHERE id=$1", [hold.invoiceId]);
    await query("DELETE FROM rentals WHERE id=$1", [hold.rentalId]);
    await query("DELETE FROM reservations WHERE listing_id=$1", [ids.listing]);
  });

  it("atomically consumes the target reservation and promotes on activation", async () => {
    await reserveTarget();
    const hold = await pendingInvoice(ids.target);
    await transaction((db) => settleCheckoutInvoice(db, {
      invoiceId: hold.invoiceId,
      provider: "SIMULATION",
      providerReference: `sim-${hold.invoiceId}`,
      amountMinor: 550,
      currency: "usd",
    }));
    expect((await query("SELECT status FROM rentals WHERE id=$1", [hold.rentalId])).rows[0]?.status).toBe("ACTIVE");
    expect((await query("SELECT role FROM users WHERE id=$1", [ids.target])).rows[0]?.role).toBe("RENTER");
    expect((await query("SELECT status FROM reservations WHERE listing_id=$1", [ids.listing])).rows[0]?.status).toBe("COMPLETED");
    await query("UPDATE rentals SET status='ENDED' WHERE id=$1", [hold.rentalId]);
  });

  it("ends an expired ACTIVE rental before creating a replacement hold", async () => {
    await query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1", [ids.target]);
    await query("DELETE FROM reservations WHERE listing_id=$1", [ids.listing]);
    const expired = await query<{ id: string }>(
      "INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'ACTIVE',now()-interval '2 weeks',now()-interval '1 minute') RETURNING id",
      [ids.listing, ids.target],
    );
    const hold = await transaction((db) => createCheckoutHold(db, ids.listing, ids.target));
    expect((await query("SELECT status FROM rentals WHERE id=$1", [expired.rows[0]!.id])).rows[0]?.status).toBe("ENDED");
    expect((await query("SELECT status FROM rentals WHERE id=$1", [hold.rentalId])).rows[0]?.status).toBe("PENDING");
    await query("DELETE FROM invoices WHERE id=$1", [hold.invoiceId]);
    await query("DELETE FROM rentals WHERE id=ANY($1::uuid[])", [[expired.rows[0]!.id, hold.rentalId]]);
  });

  it("keeps an unexpired reservation active when its checkout hold is abandoned", async () => {
    await query("UPDATE users SET role='RESIDENT' WHERE id=$1", [ids.target]);
    await query("DELETE FROM reservations WHERE listing_id=$1", [ids.listing]);
    await reserveTarget();
    const hold = await transaction((db) => createCheckoutHold(db, ids.listing, ids.target));
    expect((await query("SELECT status FROM reservations WHERE listing_id=$1", [ids.listing])).rows[0]?.status).toBe("ACTIVE");
    await query("UPDATE rentals SET starts_at=now()-interval '2 minutes',ends_at=now()-interval '1 minute' WHERE id=$1", [hold.rentalId]);
    await transaction((db) => cleanupExpiredPendingHolds(db, ids.listing));
    expect((await query("SELECT status FROM rentals WHERE id=$1", [hold.rentalId])).rows[0]?.status).toBe("CANCELLED");
    expect((await query("SELECT status FROM invoices WHERE id=$1", [hold.invoiceId])).rows[0]?.status).toBe("VOID");
    expect((await query("SELECT status FROM reservations WHERE listing_id=$1", [ids.listing])).rows[0]?.status).toBe("ACTIVE");
  });
});
