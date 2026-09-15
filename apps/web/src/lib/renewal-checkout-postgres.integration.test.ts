import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, query } from "@lake-tech/db";
import { acquireAttempt } from "../app/api/checkout/route.js";

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("renewal checkout allocation (PostgreSQL)", () => {
  const ids = { user: crypto.randomUUID(), property: crypto.randomUUID(), listing: crypto.randomUUID(), rental: crypto.randomUUID(), agent: crypto.randomUUID() };

  beforeAll(async () => {
    await query("INSERT INTO users(id,display_name,role) VALUES($1,'Renewal owner','RENTER'),($2,'Reservation agent','AGENT')", [ids.user, ids.agent]);
    await query("INSERT INTO properties(id,name,region_name) VALUES($1,'Renewal property','Renewal region')", [ids.property]);
    await query("INSERT INTO listings(id,property_id,slug,name,kind,description,area_sqm,prims,published) VALUES($1,$2,$3,'Renewal listing','PARCEL','Renewal checkout concurrency fixture',512,100,true)", [ids.listing, ids.property, `renewal-${ids.listing}`]);
    await query("INSERT INTO pricing(listing_id,weekly_linden,stripe_weekly_minor,stripe_currency) VALUES($1,1000,500,'usd')", [ids.listing]);
    await query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 week',now()+interval '1 week')", [ids.rental, ids.listing, ids.user]);
  });

  afterAll(async () => {
    await query("DELETE FROM reservations WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM stripe_checkout_attempts WHERE invoice_id IN (SELECT id FROM invoices WHERE listing_id=$1)", [ids.listing]);
    await query("DELETE FROM invoices WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM rentals WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM pricing WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM listings WHERE id=$1", [ids.listing]);
    await query("DELETE FROM properties WHERE id=$1", [ids.property]);
    await query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ids.user, ids.agent]]);
    await pool().end();
  });

  it("converges concurrent renewal requests and rejects renewal while reserved", async () => {
    const [first, second] = await Promise.all([
      acquireAttempt({ rentalId: ids.rental }, ids.user),
      acquireAttempt({ rentalId: ids.rental }, ids.user),
    ]);
    expect(second.attemptId).toBe(first.attemptId);
    expect(second.invoiceId).toBe(first.invoiceId);
    expect((await query<{ n: number }>("SELECT count(*)::int n FROM invoices WHERE rental_id=$1 AND status='OPEN'", [ids.rental])).rows[0]?.n).toBe(1);

    await query("UPDATE stripe_checkout_attempts SET status='EXPIRED' WHERE id=$1", [first.attemptId]);
    await query("UPDATE invoices SET status='VOID' WHERE id=$1", [first.invoiceId]);
    await query("INSERT INTO reservations(listing_id,target_user_id,created_by_user_id,status,expires_at,idempotency_key,request_fingerprint) VALUES($1,$2,$3,'ACTIVE',now()+interval '1 hour',$4,$5)", [ids.listing, ids.user, ids.agent, `renewal-block-${ids.listing}`, "f".repeat(64)]);
    await expect(acquireAttempt({ rentalId: ids.rental }, ids.user)).rejects.toThrow("rental unavailable");
  });
});
