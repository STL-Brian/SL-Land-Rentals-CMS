import { describe, expect, it } from "vitest";
import { createCheckoutHold, createRenewalCheckoutHold, settleCheckoutInvoice } from "./checkout.js";

function fakeDb(handler: (sql: string, values: unknown[]) => { rows?: Record<string, unknown>[]; rowCount?: number }) {
  const calls: string[] = [];
  return {
    calls,
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, values: unknown[] = []) => {
      calls.push(sql.replace(/\s+/g, " ").trim());
      const result = handler(sql, values);
      return { rows: (result.rows ?? []) as T[], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
    },
  };
}

describe("checkout holds", () => {
  it("creates a provider-aligned 32-minute pending rental before its bound invoice", async () => {
    let invoiceValues: unknown[] = [];
    const db = fakeDb((sql, values) => {
      if (sql.includes("SELECT active,role FROM users")) return { rows: [{ active: true, role: "RESIDENT" }] };
      if (sql.includes("SELECT l.id")) return { rows: [{ id: "listing", name: "Parcel", stripe_weekly_minor: 799, stripe_setup_minor: 100, stripe_currency: "usd" }] };
      if (sql.includes("INSERT INTO rentals")) return { rows: [{ id: "rental" }] };
      if (sql.includes("INSERT INTO invoices")) { invoiceValues = values; return { rows: [{ id: "invoice" }] }; }
      return {};
    });

    const hold = await createCheckoutHold(db, "listing", "user");
    expect(hold).toMatchObject({ invoiceId: "invoice", rentalId: "rental", stripeWeeklyMinor: 799, stripeSetupMinor: 100 });
    expect(invoiceValues[3]).toBe(899);
    expect(db.calls.findIndex((sql) => sql.includes("INSERT INTO rentals"))).toBeLessThan(db.calls.findIndex((sql) => sql.includes("INSERT INTO invoices")));
    expect(db.calls.some((sql) => sql.includes("reservations") && sql.includes("expires_at>now()"))).toBe(true);
    expect(db.calls.some((sql) => sql.includes("'PENDING'") && sql.includes("interval '32 minutes'"))).toBe(true);
  });

  it("atomically activates the exact unexpired invoice-bound hold for one week", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("SELECT listing_id,user_id FROM invoices")) return { rows: [{ listing_id: "listing", user_id: "user" }] };
      if (sql.includes("SELECT active,role FROM users")) return { rows: [{ active: true, role: "RESIDENT" }] };
      if (sql.includes("FROM invoices i")) return { rows: [{ invoice_id: "invoice", rental_id: "rental", listing_id: "listing", user_id: "user", rental_status: "PENDING", amount_minor: 799, currency: "usd" }] };
      if (sql.includes("INSERT INTO payments")) return { rows: [{ id: "payment" }] };
      return { rowCount: 1 };
    });

    const paymentId = await settleCheckoutInvoice(db, {
      invoiceId: "invoice",
      provider: "STRIPE",
      providerReference: "pi_1",
      amountMinor: 799,
      currency: "usd",
    });
    expect(paymentId).toBe("payment");
    expect(db.calls.some((sql) => sql.includes("UPDATE users") && sql.includes("role='RENTER'") && sql.includes("role='RESIDENT'"))).toBe(true);
    expect(db.calls.some((sql) => sql.includes("UPDATE rentals") && sql.includes("interval '1 week'") && sql.includes("status='ACTIVE'"))).toBe(true);
    expect(db.calls.some((sql) => sql.includes("GREATEST(ends_at,now())"))).toBe(true);
  });

  it("creates an owner-scoped active-rental renewal invoice without setup cost",async()=>{
    let invoiceValues:unknown[]=[];
    const db=fakeDb((sql,values)=>{
      if(sql.includes("SELECT listing_id FROM rentals"))return{rows:[{listing_id:"listing"}]};
      if(sql.includes("FROM rentals r")&&sql.includes("FOR UPDATE"))return{rows:[{rental_id:"rental",listing_id:"listing",name:"Parcel",stripe_weekly_minor:799,stripe_currency:"usd"}]};
      if(sql.includes("INSERT INTO invoices")){invoiceValues=values;return{rows:[{id:"invoice"}]};}
      return{};
    });
    const hold=await createRenewalCheckoutHold(db,"rental","user");
    expect(hold).toMatchObject({invoiceId:"invoice",rentalId:"rental",listingId:"listing",stripeWeeklyMinor:799,stripeSetupMinor:0});
    expect(invoiceValues[3]).toBe(799);
    expect(db.calls.some(sql=>sql.includes("r.user_id=$2")&&sql.includes("r.status='ACTIVE'"))).toBe(true);
    expect(db.calls.some(sql=>sql.includes("INSERT INTO rentals"))).toBe(false);
  });

  it("rejects amount mismatch without activating the hold", async () => {
    const db = fakeDb((sql) => {
      if (sql.includes("SELECT listing_id,user_id FROM invoices")) return { rows: [{ listing_id: "listing", user_id: "user" }] };
      if (sql.includes("SELECT active,role FROM users")) return { rows: [{ active: true, role: "RESIDENT" }] };
      if (sql.includes("FROM invoices i")) return { rows: [{ invoice_id: "invoice", rental_id: "rental", listing_id: "listing", user_id: "user", rental_status: "PENDING", amount_minor: 799, currency: "usd" }] };
      return {};
    });
    await expect(settleCheckoutInvoice(db, {
      invoiceId: "invoice",
      provider: "STRIPE",
      providerReference: "pi_2",
      amountMinor: 800,
      currency: "usd",
    })).rejects.toThrow(/binding/i);
    expect(db.calls.some((sql) => sql.includes("UPDATE rentals"))).toBe(false);
  });
});
