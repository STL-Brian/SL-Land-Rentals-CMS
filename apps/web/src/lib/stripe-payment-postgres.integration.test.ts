import{afterAll,beforeAll,describe,expect,it}from"vitest";import type Stripe from"stripe";import type{PoolClient}from"pg";import{pool}from"@lake-tech/db";import{handleStripeEvent}from"./stripe-event-handler.js";const enabled=Boolean(process.env.DATABASE_URL);const suite=enabled?describe:describe.skip;
suite("Stripe payment behavior (PostgreSQL)",()=>{let db:PoolClient;const user=crypto.randomUUID(),property=crypto.randomUUID(),listing=crypto.randomUUID();beforeAll(async()=>{db=await pool().connect();await db.query("BEGIN");await db.query("INSERT INTO users(id,display_name) VALUES($1,'Payment Test')",[user]);await db.query("INSERT INTO properties(id,name,region_name) VALUES($1,'P','R')",[property]);await db.query("INSERT INTO listings(id,property_id,slug,name,kind,description,area_sqm,prims,published) VALUES($1,$2,$3,'L','PARCEL','A sufficiently long description',512,100,true)",[listing,property,`payment-${listing}`])});afterAll(async()=>{await db.query("ROLLBACK");db.release()});
 async function payment(reference:string,amount=1000){const invoice=crypto.randomUUID(),id=crypto.randomUUID();await db.query("INSERT INTO invoices(id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'PAID',$4,'usd',now())",[invoice,listing,user,amount]);await db.query("INSERT INTO payments(id,invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status) VALUES($1,$2,'STRIPE',$3,$4,'usd',$4,'usd','CONFIRMED')",[id,invoice,reference,amount]);return id}
 const event=(id:string,type:string,object:unknown)=>({id,type,data:{object}})as Stripe.Event;
 async function attempt(invoiceId:string,sessionId:string){const attemptId=crypto.randomUUID();await db.query("INSERT INTO stripe_checkout_attempts(id,invoice_id,generation,idempotency_key,session_id,status,provider_expires_at) VALUES($1,$2,1,$3,$4,'OPEN',extract(epoch from now())::bigint+1800)",[attemptId,invoiceId,`attempt-${attemptId}`,sessionId]);return attemptId;}
 it("keeps partial, pending, and failed refunds in review and only marks cumulative success refunded",async()=>{const id=await payment("pi_refunds");expect(await handleStripeEvent(db,event("evt_partial","refund.created",{id:"re_1",amount:250,status:"succeeded",payment_intent:{id:"pi_refunds"},charge:{id:"ch_1"}}))).toBe("MANUAL_REVIEW");expect((await db.query("SELECT status FROM payments WHERE id=$1",[id])).rows[0].status).toBe("MANUAL_REVIEW");expect(await handleStripeEvent(db,event("evt_pending","refund.updated",{id:"re_2",amount:750,status:"pending",payment_intent:"pi_refunds",charge:"ch_1"}))).toBe("MANUAL_REVIEW");expect(await handleStripeEvent(db,event("evt_failed","refund.failed",{id:"re_2",amount:750,status:"failed",payment_intent:"pi_refunds",charge:"ch_1"}))).toBe("MANUAL_REVIEW");expect(await handleStripeEvent(db,event("evt_full","refund.updated",{id:"re_2",amount:750,status:"succeeded",payment_intent:"pi_refunds",charge:"ch_1"}))).toBe("COMPLETE");const row=(await db.query("SELECT status,reconciliation_note FROM payments WHERE id=$1",[id])).rows[0];expect(row.status).toBe("REFUNDED");expect(row.reconciliation_note).toContain("1000/1000")});
 it("handles expandable charge refunds and disputes without passing objects to PostgreSQL",async()=>{const refunded=await payment("pi_charge",500);expect(await handleStripeEvent(db,event("evt_charge","charge.refunded",{id:"ch_charge",amount:500,amount_refunded:500,refunded:true,payment_intent:{id:"pi_charge"}}))).toBe("COMPLETE");expect((await db.query("SELECT status FROM payments WHERE id=$1",[refunded])).rows[0].status).toBe("REFUNDED");const disputed=await payment("pi_dispute",700);expect(await handleStripeEvent(db,event("evt_dispute","charge.dispute.created",{id:"dp_1",charge:{id:"ch_dispute"},payment_intent:{id:"pi_dispute"}}))).toBe("MANUAL_REVIEW");expect((await db.query("SELECT status FROM payments WHERE id=$1",[disputed])).rows[0].status).toBe("MANUAL_REVIEW")});
 it("durably queues late-payment refund in the same database transaction",async()=>{const rental=crypto.randomUUID(),invoice=crypto.randomUUID();await db.query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'CANCELLED',now()-interval '1 hour',now()-interval '30 minutes')",[rental,listing,user]);await db.query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'VOID',1000,'usd',now()-interval '30 minutes')",[invoice,rental,listing,user]);await db.query("INSERT INTO stripe_events(event_id,event_type,payload_sha256,processing_status) VALUES('evt_late','checkout.session.completed',$1,'PROCESSING')",["b".repeat(64)]);const attemptId=await attempt(invoice,"cs_late");const status=await handleStripeEvent(db,event("evt_late","checkout.session.completed",{id:"cs_late",client_reference_id:invoice,metadata:{invoiceId:invoice,attemptId},amount_total:1000,currency:"usd",payment_status:"paid",payment_intent:{id:"pi_late"}}));expect(status).toBe("MANUAL_REVIEW");const action=(await db.query("SELECT state,idempotency_key,provider_reference FROM provider_actions WHERE invoice_id=$1",[invoice])).rows[0];expect(action).toMatchObject({state:"QUEUED",idempotency_key:"lte-late-refund-cs_late",provider_reference:"pi_late"});expect((await db.query("SELECT status FROM payments WHERE invoice_id=$1",[invoice])).rows[0].status).toBe("MANUAL_REVIEW")});
 it("settles an ACTIVE-rental renewal once through handleStripeEvent",async()=>{
  const rental=crypto.randomUUID(),invoice=crypto.randomUUID();
  await db.query("UPDATE users SET role='RESIDENT' WHERE id=$1",[user]);
  await db.query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 week',now()+interval '2 days')",[rental,listing,user]);
  await db.query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'OPEN',1000,'usd',now()+interval '30 minutes')",[invoice,rental,listing,user]);
  const attemptId=await attempt(invoice,"cs_renewal");
  const renewal=event("evt_renewal","checkout.session.completed",{id:"cs_renewal",client_reference_id:invoice,metadata:{invoiceId:invoice,attemptId},amount_total:1000,currency:"usd",payment_status:"paid",payment_intent:"pi_renewal"});
  const before=await db.query<{ends_at:Date}>("SELECT ends_at FROM rentals WHERE id=$1",[rental]);
  expect(await handleStripeEvent(db,renewal)).toBe("COMPLETE");
  expect(await handleStripeEvent(db,renewal)).toBe("COMPLETE");
  const after=await db.query<{ends_at:Date}>("SELECT ends_at FROM rentals WHERE id=$1",[rental]);
  expect(after.rows[0]!.ends_at.getTime()-before.rows[0]!.ends_at.getTime()).toBe(7*24*60*60*1000);
  expect((await db.query("SELECT status FROM invoices WHERE id=$1",[invoice])).rows[0].status).toBe("PAID");
  expect((await db.query("SELECT count(*)::int n FROM payments WHERE invoice_id=$1",[invoice])).rows[0].n).toBe(1);
  expect((await db.query("SELECT count(*)::int n FROM provider_actions WHERE invoice_id=$1",[invoice])).rows[0].n).toBe(0);
  expect((await db.query("SELECT role FROM users WHERE id=$1",[user])).rows[0].role).toBe("RENTER");
  await db.query("UPDATE rentals SET status='ENDED' WHERE id=$1",[rental]);
 });
 it("queues paid renewal conflicts instead of extending an ended or wrong-owner rental",async()=>{
  const other=crypto.randomUUID();await db.query("INSERT INTO users(id,display_name) VALUES($1,'Wrong renewal owner')",[other]);
  for(const conflict of ["ENDED","WRONG_OWNER"] as const){
   const rental=crypto.randomUUID(),invoice=crypto.randomUUID(),reference=`pi_${conflict.toLowerCase()}`;
   await db.query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,$4,now()-interval '1 week',now()+interval '2 days')",[rental,listing,user,conflict==="ENDED"?"ENDED":"ACTIVE"]);
   await db.query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'OPEN',1000,'usd',now()+interval '30 minutes')",[invoice,rental,listing,conflict==="WRONG_OWNER"?other:user]);
   const eventId=`evt_${conflict.toLowerCase()}`,sessionId=`cs_${conflict.toLowerCase()}`;
   await db.query("INSERT INTO stripe_events(event_id,event_type,payload_sha256,processing_status) VALUES($1,'checkout.session.completed',$2,'PROCESSING')",[eventId,"e".repeat(64)]);
   const attemptId=await attempt(invoice,sessionId);
   const result=await handleStripeEvent(db,event(eventId,"checkout.session.completed",{id:sessionId,client_reference_id:invoice,metadata:{invoiceId:invoice,attemptId},amount_total:1000,currency:"usd",payment_status:"paid",payment_intent:reference}));
   expect(result).toBe("MANUAL_REVIEW");
   expect((await db.query("SELECT state FROM provider_actions WHERE invoice_id=$1",[invoice])).rows[0].state).toBe("QUEUED");
   await db.query("UPDATE rentals SET status='ENDED' WHERE id=$1",[rental]);
  }
 });
 it("rejects a paid session that is not the session persisted for its checkout attempt",async()=>{
  const rental=crypto.randomUUID(),invoice=crypto.randomUUID();
  await db.query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 week',now()+interval '2 days')",[rental,listing,user]);
  await db.query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'OPEN',1000,'usd',now()+interval '30 minutes')",[invoice,rental,listing,user]);
  const attemptId=await attempt(invoice,"cs_authorized");
  const forged=event("evt_forged","checkout.session.completed",{id:"cs_other",client_reference_id:invoice,metadata:{invoiceId:invoice,attemptId},amount_total:1000,currency:"usd",payment_status:"paid",payment_intent:"pi_forged"});
  await expect(handleStripeEvent(db,forged)).rejects.toThrow("persisted attempt");
  expect((await db.query("SELECT count(*)::int n FROM payments WHERE provider_reference='pi_forged'")).rows[0].n).toBe(0);
  await db.query("UPDATE rentals SET status='ENDED' WHERE id=$1",[rental]);
 });
 it("rejects reuse of a provider reference with a conflicting invoice payload",async()=>{
  const existingInvoice=crypto.randomUUID();
  await db.query("INSERT INTO invoices(id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'PAID',900,'usd',now())",[existingInvoice,listing,user]);
  await db.query("INSERT INTO payments(invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status) VALUES($1,'STRIPE','pi_shared_conflict',900,'usd',900,'usd','CONFIRMED')",[existingInvoice]);
  const rental=crypto.randomUUID(),invoice=crypto.randomUUID();
  await db.query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'ACTIVE',now()-interval '1 week',now()+interval '2 days')",[rental,listing,user]);
  await db.query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'OPEN',1000,'usd',now()+interval '30 minutes')",[invoice,rental,listing,user]);
  const attemptId=await attempt(invoice,"cs_conflict");
  const conflict=event("evt_conflict","checkout.session.completed",{id:"cs_conflict",client_reference_id:invoice,metadata:{invoiceId:invoice,attemptId},amount_total:1000,currency:"usd",payment_status:"paid",payment_intent:"pi_shared_conflict"});
  await expect(handleStripeEvent(db,conflict)).rejects.toThrow("provider reference payload conflict");
  expect((await db.query("SELECT invoice_id FROM payments WHERE provider_reference='pi_shared_conflict'")).rows[0].invoice_id).toBe(existingInvoice);
  await db.query("UPDATE rentals SET status='ENDED' WHERE id=$1",[rental]);
 });
 it("durably reviews and refunds paid sessions for ineligible owners",async()=>{
  for(const [label,active,role] of [["inactive",false,"RESIDENT"],["manager",true,"MANAGER"],["agent",true,"AGENT"]] as const){
   const rental=crypto.randomUUID(),invoice=crypto.randomUUID(),sessionId=`cs_ineligible_${label}`,eventId=`evt_ineligible_${label}`,reference=`pi_ineligible_${label}`;
   await db.query("UPDATE users SET active=$2,role=$3::user_role WHERE id=$1",[user,active,role]);
   await db.query("ALTER TABLE rentals DISABLE TRIGGER rentals_require_eligible_user");
   try{await db.query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'PENDING',now(),now()+interval '30 minutes')",[rental,listing,user]);}
   finally{await db.query("ALTER TABLE rentals ENABLE TRIGGER rentals_require_eligible_user");}
   await db.query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'OPEN',1000,'usd',now()+interval '30 minutes')",[invoice,rental,listing,user]);
   const attemptId=await attempt(invoice,sessionId);await db.query("INSERT INTO stripe_events(event_id,event_type,payload_sha256,processing_status) VALUES($1,'checkout.session.completed',$2,'PROCESSING')",[eventId,"a".repeat(64)]);
   const status=await handleStripeEvent(db,event(eventId,"checkout.session.completed",{id:sessionId,client_reference_id:invoice,metadata:{invoiceId:invoice,attemptId},amount_total:1000,currency:"usd",payment_status:"paid",payment_intent:reference}));
   expect(status).toBe("MANUAL_REVIEW");expect((await db.query("SELECT status FROM payments WHERE invoice_id=$1",[invoice])).rows[0].status).toBe("MANUAL_REVIEW");expect((await db.query("SELECT state,provider_reference FROM provider_actions WHERE invoice_id=$1",[invoice])).rows[0]).toMatchObject({state:"QUEUED",provider_reference:reference});expect((await db.query("SELECT status FROM rentals WHERE id=$1",[rental])).rows[0].status).toBe("PENDING");
   await db.query("UPDATE rentals SET status='CANCELLED' WHERE id=$1",[rental]);await db.query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1",[user]);
  }
 });
 it("expires only the invoice and pending rental bound to the exact persisted checkout session",async()=>{
  const rental=crypto.randomUUID(),invoice=crypto.randomUUID();
  await db.query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'PENDING',now(),now()+interval '30 minutes')",[rental,listing,user]);
  await db.query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'OPEN',1000,'usd',now()+interval '30 minutes')",[invoice,rental,listing,user]);
  const attemptId=await attempt(invoice,"cs_expire_bound");
  const forged=event("evt_expire_forged","checkout.session.expired",{id:"cs_expire_other",client_reference_id:invoice,metadata:{invoiceId:invoice,attemptId}});
  await expect(handleStripeEvent(db,forged)).rejects.toThrow("persisted attempt");
  expect((await db.query("SELECT status FROM invoices WHERE id=$1",[invoice])).rows[0].status).toBe("OPEN");
  expect((await db.query("SELECT status FROM rentals WHERE id=$1",[rental])).rows[0].status).toBe("PENDING");
  expect((await db.query("SELECT status FROM stripe_checkout_attempts WHERE id=$1",[attemptId])).rows[0].status).toBe("OPEN");
  expect(await handleStripeEvent(db,event("evt_expire_bound","checkout.session.expired",{id:"cs_expire_bound",client_reference_id:invoice,metadata:{invoiceId:invoice,attemptId}}))).toBe("COMPLETE");
  expect((await db.query("SELECT status FROM invoices WHERE id=$1",[invoice])).rows[0].status).toBe("VOID");
  expect((await db.query("SELECT status FROM rentals WHERE id=$1",[rental])).rows[0].status).toBe("CANCELLED");
 });
});
