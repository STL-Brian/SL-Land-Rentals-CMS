import { assertEligibleRentalUser } from "./rental-eligibility";

interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: T[] }>;
}

export interface CheckoutHold {
  invoiceId: string;
  rentalId: string;
  listingId: string;
  name: string;
  stripeWeeklyMinor: number;
  stripeSetupMinor: number;
  stripeCurrency: string;
}

export async function cleanupExpiredPendingHolds(db: Queryable, listingId?: string): Promise<void> {
  await db.query(
    "UPDATE rentals SET status='ENDED' WHERE status='ACTIVE' AND ends_at<=now() AND ($1::uuid IS NULL OR listing_id=$1)",
    [listingId ?? null],
  );
  await db.query(
    `WITH expired AS (
       UPDATE rentals SET status='CANCELLED'
       WHERE status='PENDING' AND ends_at<=now() AND ($1::uuid IS NULL OR listing_id=$1)
       RETURNING id
     ), expired_attempts AS (
       UPDATE stripe_checkout_attempts SET status='EXPIRED',updated_at=now()
       WHERE invoice_id IN (SELECT id FROM invoices WHERE rental_id IN (SELECT id FROM expired))
         AND status IN ('CREATING','OPEN','FAILED')
     )
     UPDATE invoices SET status='VOID'
     WHERE status='OPEN' AND rental_id IN (SELECT id FROM expired)`,
    [listingId ?? null],
  );
}

export const expirePendingHolds=cleanupExpiredPendingHolds;

export async function createCheckoutHold(db: Queryable, listingId: string, userId: string): Promise<CheckoutHold> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`listing:${listingId}`]);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user-role:${userId}`]);
  await assertEligibleRentalUser(db, userId);
  await cleanupExpiredPendingHolds(db,listingId);
  await db.query("UPDATE reservations SET status='EXPIRED' WHERE listing_id=$1 AND status='ACTIVE' AND expires_at<=now()", [listingId]);
  const listing = await db.query<{
    id: string;
    name: string;
    stripe_weekly_minor: number;
    stripe_setup_minor: number;
    stripe_currency: string;
  }>(
    `SELECT l.id,l.name,p.stripe_weekly_minor,p.stripe_setup_minor,p.stripe_currency
     FROM listings l
     JOIN pricing p ON p.listing_id=l.id AND p.active
     WHERE l.id=$1 AND l.published
       AND NOT EXISTS (
         SELECT 1 FROM rentals r
         WHERE r.listing_id=l.id AND r.status IN ('PENDING','ACTIVE') AND r.ends_at>now()
       )
       AND NOT EXISTS (
         SELECT 1 FROM reservations x
         WHERE x.listing_id=l.id AND x.status='ACTIVE' AND x.expires_at>now() AND x.target_user_id<>$2
       )
     FOR UPDATE OF l`,
    [listingId, userId],
  );
  const item = listing.rows[0];
  if (!item) throw new Error("listing unavailable");

  const rental = await db.query<{ id: string }>(
    `INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at)
     VALUES($1,$2,'PENDING',now(),now()+interval '32 minutes')
     RETURNING id`,
    [item.id, userId],
  );
  const rentalId = rental.rows[0]!.id;
  const invoice = await db.query<{ id: string }>(
    `INSERT INTO invoices(rental_id,listing_id,user_id,status,amount_minor,currency,due_at)
     VALUES($1,$2,$3,'OPEN',$4,$5,now()+interval '32 minutes')
     RETURNING id`,
    [rentalId, item.id, userId, item.stripe_weekly_minor + item.stripe_setup_minor, item.stripe_currency],
  );

  return {
    invoiceId: invoice.rows[0]!.id,
    rentalId,
    listingId: item.id,
    name: item.name,
    stripeWeeklyMinor: item.stripe_weekly_minor,
    stripeSetupMinor: item.stripe_setup_minor,
    stripeCurrency: item.stripe_currency.trim().toLowerCase(),
  };
}

export async function createRenewalCheckoutHold(db: Queryable, rentalId: string, userId: string): Promise<CheckoutHold> {
  const preflight=await db.query<{listing_id:string}>("SELECT listing_id FROM rentals WHERE id=$1 AND user_id=$2",[rentalId,userId]);
  if(!preflight.rows[0])throw new Error("rental unavailable");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`listing:${preflight.rows[0].listing_id}`]);
  await db.query("UPDATE reservations SET status='EXPIRED' WHERE listing_id=$1 AND status='ACTIVE' AND expires_at<=now()",[preflight.rows[0].listing_id]);
  const rental=await db.query<{
    rental_id:string;listing_id:string;name:string;stripe_weekly_minor:number;stripe_currency:string;
  }>(`SELECT r.id rental_id,l.id listing_id,l.name,p.stripe_weekly_minor,p.stripe_currency
      FROM rentals r JOIN listings l ON l.id=r.listing_id JOIN pricing p ON p.listing_id=l.id AND p.active
      WHERE r.id=$1 AND r.user_id=$2 AND r.status='ACTIVE' AND r.ends_at>now() AND l.published
        AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.listing_id=r.listing_id AND x.status='ACTIVE' AND x.expires_at>now())
        AND NOT EXISTS (SELECT 1 FROM invoices i JOIN stripe_checkout_attempts a ON a.invoice_id=i.id
          WHERE i.rental_id=r.id AND i.status='OPEN' AND a.status IN ('CREATING','OPEN','FAILED'))
      FOR UPDATE OF r,l`,[rentalId,userId]);
  const item=rental.rows[0];
  if(!item)throw new Error("rental unavailable");

  const invoice=await db.query<{id:string}>(`INSERT INTO invoices(rental_id,listing_id,user_id,status,amount_minor,currency,due_at)
      VALUES($1,$2,$3,'OPEN',$4,$5,now()+interval '32 minutes') RETURNING id`,
      [item.rental_id,item.listing_id,userId,item.stripe_weekly_minor,item.stripe_currency]);
  return {invoiceId:invoice.rows[0]!.id,rentalId:item.rental_id,listingId:item.listing_id,name:item.name,
    stripeWeeklyMinor:item.stripe_weekly_minor,stripeSetupMinor:0,stripeCurrency:item.stripe_currency.trim().toLowerCase()};
}

export interface CheckoutSettlement {
  invoiceId: string;
  provider: "STRIPE" | "SIMULATION";
  providerReference: string;
  amountMinor: number;
  currency: string;
}

export async function settleCheckoutInvoice(db: Queryable, settlement: CheckoutSettlement): Promise<string> {
  const preflight = await db.query<{ listing_id: string; user_id:string }>(
    "SELECT listing_id,user_id FROM invoices WHERE id=$1",
    [settlement.invoiceId],
  );
  if (!preflight.rows[0]) throw new Error("payment binding mismatch or expired hold");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`listing:${preflight.rows[0].listing_id}`]);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user-role:${preflight.rows[0].user_id}`]);
  await assertEligibleRentalUser(db, preflight.rows[0].user_id);
  await db.query(
    "UPDATE reservations SET status='EXPIRED' WHERE listing_id=$1 AND status='ACTIVE' AND expires_at<=now()",
    [preflight.rows[0].listing_id],
  );

  const invoice = await db.query<{
    invoice_id: string;
    rental_id: string;
    listing_id: string;
    user_id: string;
    rental_status: "PENDING" | "ACTIVE";
    amount_minor: number;
    currency: string;
  }>(
    `SELECT i.id AS invoice_id,i.rental_id,i.listing_id,i.user_id,
            r.status AS rental_status,i.amount_minor,i.currency
     FROM invoices i
     JOIN rentals r ON r.id=i.rental_id AND r.listing_id=i.listing_id AND r.user_id=i.user_id
     WHERE i.id=$1 AND i.status='OPEN' AND i.due_at>now()
       AND r.status IN ('PENDING','ACTIVE') AND r.ends_at>now()
     FOR UPDATE OF i,r`,
    [settlement.invoiceId],
  );
  const bound = invoice.rows[0];
  if (!bound || bound.amount_minor !== settlement.amountMinor || bound.currency.trim().toLowerCase() !== settlement.currency.toLowerCase()) {
    throw new Error("payment binding mismatch or expired hold");
  }
  const reservation = await db.query<{ id: string; target_user_id: string }>(
    "SELECT id,target_user_id FROM reservations WHERE listing_id=$1 AND status='ACTIVE' AND expires_at>now() FOR UPDATE",
    [bound.listing_id],
  );
  if (reservation.rows[0] && (bound.rental_status !== "PENDING" || reservation.rows[0].target_user_id !== bound.user_id)) {
    throw new Error("RESERVATION_CONFLICT");
  }

  const activated = await db.query(
    `UPDATE rentals
     SET status='ACTIVE',starts_at=CASE WHEN status='PENDING' THEN now() ELSE starts_at END,
         ends_at=CASE WHEN status='PENDING' THEN now()+interval '1 week' ELSE GREATEST(ends_at,now())+interval '1 week' END
     WHERE id=$1 AND status IN ('PENDING','ACTIVE')`,
    [bound.rental_id],
  );
  if (activated.rowCount !== 1) throw new Error("hold activation conflict");
  if (reservation.rows[0]) {
    const consumed = await db.query(
      "UPDATE reservations SET status='COMPLETED' WHERE id=$1 AND status='ACTIVE'",
      [reservation.rows[0].id],
    );
    if (consumed.rowCount !== 1) throw new Error("RESERVATION_CONFLICT");
  }
  await db.query("UPDATE users SET role='RENTER' WHERE id=$1 AND role='RESIDENT'", [bound.user_id]);

  const payment = await db.query<{ id: string }>(
    `INSERT INTO payments(invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status)
     VALUES($1,$2,$3,$4,$5,$4,$5,'CONFIRMED')
     RETURNING id`,
    [settlement.invoiceId, settlement.provider, settlement.providerReference, settlement.amountMinor, settlement.currency.toLowerCase()],
  );
  await db.query("UPDATE invoices SET status='PAID' WHERE id=$1 AND status='OPEN'", [settlement.invoiceId]);
  return payment.rows[0]!.id;
}
