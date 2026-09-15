import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {pool,query,transaction} from "@lake-tech/db";
import {cleanupExpiredPendingHolds} from "./checkout.js";
import {lockPaymentForReconciliation,retryProviderAction,retryStripeEvent,resolveProviderAction,resolveStripeEvent} from "./reconciliation.js";
import {runOneProviderAction,type Transaction as ProviderTransaction} from "../../../sl-bot/src/provider-actions.js";
import {checkoutSessionParameters,loadExistingCheckoutAttempt} from "./checkout-attempt.js";
import {handleStripeEvent} from "./stripe-event-handler.js";

const suite=process.env.DATABASE_URL?describe:describe.skip;
suite("cycle 3 payment integrity (PostgreSQL)",()=>{
  const ids={user:crypto.randomUUID(),property:crypto.randomUUID(),listing:crypto.randomUUID(),actor:crypto.randomUUID()};
  beforeAll(async()=>{
    await query("INSERT INTO users(id,display_name,role) VALUES($1,'Cycle 3 renter','RENTER'),($2,'Cycle 3 admin','ADMINISTRATOR')",[ids.user,ids.actor]);
    await query("INSERT INTO properties(id,name,region_name) VALUES($1,'Cycle 3','Cycle 3')",[ids.property]);
    await query("INSERT INTO listings(id,property_id,slug,name,kind,description,area_sqm,prims,published) VALUES($1,$2,$3,'Cycle 3 Parcel','PARCEL','Cycle 3 integration test listing',512,100,true)",[ids.listing,ids.property,`cycle-3-${ids.listing}`]);
    await query("INSERT INTO pricing(listing_id,weekly_linden,setup_linden,stripe_weekly_minor,stripe_setup_minor,stripe_currency,active) VALUES($1,1000,100,2000,200,'usd',true)",[ids.listing]);
  });
  afterAll(async()=>{await query("DELETE FROM audit_log WHERE actor_user_id=$1",[ids.actor]);await query("DELETE FROM provider_actions WHERE invoice_id IN (SELECT id FROM invoices WHERE listing_id=$1)",[ids.listing]);await query("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE listing_id=$1)",[ids.listing]);await query("DELETE FROM stripe_checkout_attempts WHERE invoice_id IN (SELECT id FROM invoices WHERE listing_id=$1)",[ids.listing]);await query("DELETE FROM invoices WHERE listing_id=$1",[ids.listing]);await query("DELETE FROM rentals WHERE listing_id=$1",[ids.listing]);await query("DELETE FROM pricing WHERE listing_id=$1",[ids.listing]);await query("DELETE FROM listings WHERE id=$1",[ids.listing]);await query("DELETE FROM properties WHERE id=$1",[ids.property]);await query("DELETE FROM users WHERE id=ANY($1::uuid[])",[[ids.user,ids.actor]]);});

  it("allows terminal-style START after cleaning an expired CREATING/FAILED checkout hold",async()=>{
    const rental=crypto.randomUUID(),invoice=crypto.randomUUID(),creating=crypto.randomUUID(),failed=crypto.randomUUID();
    await query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'PENDING',now()-interval '40 minutes',now()-interval '8 minutes')",[rental,ids.listing,ids.user]);
    await query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'OPEN',2200,'usd',now()-interval '8 minutes')",[invoice,rental,ids.listing,ids.user]);
    await query("INSERT INTO stripe_checkout_attempts(id,invoice_id,generation,idempotency_key,status,provider_expires_at) VALUES($1,$2,1,$3,'CREATING',extract(epoch from now())::bigint+1860),($4,$2,2,$5,'FAILED',extract(epoch from now())::bigint+1860)",[creating,invoice,`creating-${creating}`,failed,`failed-${failed}`]);
    await transaction(async db=>{await cleanupExpiredPendingHolds(db,ids.listing);const started=await db.query("INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'ACTIVE',now(),now()+interval '1 week') ON CONFLICT DO NOTHING RETURNING id",[ids.listing,ids.user]);expect(started.rowCount).toBe(1);});
    expect((await query("SELECT status FROM rentals WHERE id=$1",[rental])).rows[0]?.status).toBe("CANCELLED");
    expect((await query("SELECT status FROM invoices WHERE id=$1",[invoice])).rows[0]?.status).toBe("VOID");
    expect((await query("SELECT status FROM stripe_checkout_attempts WHERE id=ANY($1::uuid[]) ORDER BY generation",[[creating,failed]])).rows.map(r=>r.status)).toEqual(["EXPIRED","EXPIRED"]);
    await query("DELETE FROM rentals WHERE listing_id=$1 AND status='ACTIVE'",[ids.listing]);
  });

  it("state-gates an admin Stripe retry that waits behind completion without replay or audit",async()=>{
    const eventId=`evt_${crypto.randomUUID()}`,invoice=crypto.randomUUID(),rental=crypto.randomUUID();
    const payload={id:eventId,type:"checkout.session.completed",data:{object:{id:`cs_${eventId}`,client_reference_id:invoice,metadata:{invoiceId:invoice},amount_total:2200,currency:"usd",payment_status:"paid",payment_intent:`pi_${eventId}`}}};
    await query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'CANCELLED',now()-interval '1 hour',now()-interval '1 minute')",[rental,ids.listing,ids.user]);
    await query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'VOID',2200,'usd',now()-interval '1 minute')",[invoice,rental,ids.listing,ids.user]);
    await query("INSERT INTO stripe_events(event_id,event_type,payload_sha256,payload,processing_status,attempts,lease_expires_at) VALUES($1,'checkout.session.completed',$2,$3,'PROCESSING',1,now()+interval '2 minutes')",[eventId,"c".repeat(64),payload]);
    const first=await pool().connect(),second=await pool().connect();
    try{await first.query("BEGIN");await first.query("SELECT event_id FROM stripe_events WHERE event_id=$1 FOR UPDATE",[eventId]);
      let settled=false;const retry=second.query("BEGIN").then(()=>retryStripeEvent(second,eventId,ids.actor,"retry")).finally(()=>{settled=true});
      await new Promise(r=>setTimeout(r,100));expect(settled).toBe(false);
      await first.query("UPDATE stripe_events SET processing_status='COMPLETE',lease_expires_at=NULL WHERE event_id=$1",[eventId]);await first.query("COMMIT");
      await expect(retry).rejects.toThrow("STATE_CONFLICT");await second.query("ROLLBACK");
      expect((await query("SELECT count(*)::int n FROM provider_actions WHERE invoice_id=$1",[invoice])).rows[0]?.n).toBe(0);
      expect((await query("SELECT count(*)::int n FROM audit_log WHERE actor_user_id=$1 AND target_id=$2",[ids.actor,eventId])).rows[0]?.n).toBe(0);
    }finally{first.release();second.release();await query("DELETE FROM stripe_events WHERE event_id=$1",[eventId]);}
  });

  it("rejects invalid retry/resolve states without audit and revives exhausted provider actions",async()=>{
    const invoice=crypto.randomUUID(),payment=crypto.randomUUID(),action=crypto.randomUUID(),eventId=`evt_${crypto.randomUUID()}`;
    await query("INSERT INTO invoices(id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'PAID',2200,'usd',now())",[invoice,ids.listing,ids.user]);
    await query("INSERT INTO payments(id,invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status) VALUES($1,$2,'STRIPE',$3,2200,'usd',2200,'usd','MANUAL_REVIEW')",[payment,invoice,`pi_${payment}`]);
    await query("INSERT INTO provider_actions(id,kind,state,invoice_id,payment_id,idempotency_key,provider_reference,amount_minor,attempts,last_error) VALUES($1,'STRIPE_REFUND','MANUAL_REVIEW',$2,$3,$4,$5,2200,12,'attempts exhausted')",[action,invoice,payment,`refund-${action}`,`pi_${payment}`]);
    await transaction(db=>retryProviderAction(db,action,ids.actor,"retry exhausted"));
    expect((await query("SELECT state,attempts,last_error,lease_expires_at FROM provider_actions WHERE id=$1",[action])).rows[0]).toMatchObject({state:"QUEUED",attempts:0,last_error:null,lease_expires_at:null});
    await expect(transaction(db=>retryProviderAction(db,action,ids.actor,"invalid repeat"))).rejects.toThrow("STATE_CONFLICT");
    await expect(transaction(db=>resolveProviderAction(db,action,ids.actor,"invalid resolve"))).rejects.toThrow("STATE_CONFLICT");
    await query("INSERT INTO stripe_events(event_id,event_type,payload_sha256,payload,processing_status) VALUES($1,'refund.updated',$2,$3,'COMPLETE')",[eventId,"d".repeat(64),{id:eventId,type:"refund.updated",data:{object:{}}}]);
    await expect(transaction(db=>resolveStripeEvent(db,eventId,ids.actor,"invalid resolve"))).rejects.toThrow("STATE_CONFLICT");
    const invalidAudits=await query("SELECT details->>'note' note FROM audit_log WHERE actor_user_id=$1 AND details->>'note' LIKE 'invalid%'",[ids.actor]);expect(invalidAudits.rowCount).toBe(0);
    await query("DELETE FROM stripe_events WHERE event_id=$1",[eventId]);await query("DELETE FROM provider_actions WHERE id=$1",[action]);await query("DELETE FROM payments WHERE id=$1",[payment]);await query("DELETE FROM invoices WHERE id=$1",[invoice]);
  });

  it("contacts the provider once after an attempt-12 action is deliberately retried",async()=>{
    const invoice=crypto.randomUUID(),payment=crypto.randomUUID(),action=crypto.randomUUID();
    await query("INSERT INTO invoices(id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'PAID',2200,'usd',now())",[invoice,ids.listing,ids.user]);
    await query("INSERT INTO payments(id,invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status) VALUES($1,$2,'STRIPE',$3,2200,'usd',2200,'usd','MANUAL_REVIEW')",[payment,invoice,`pi_${payment}`]);
    await query("INSERT INTO provider_actions(id,kind,state,invoice_id,payment_id,idempotency_key,provider_reference,amount_minor,attempts,last_error) VALUES($1,'STRIPE_REFUND','MANUAL_REVIEW',$2,$3,$4,$5,2200,12,'attempts exhausted')",[action,invoice,payment,`refund-${action}`,`pi_${payment}`]);
    await transaction(db=>retryProviderAction(db,action,ids.actor,"operator retry"));
    const provider=vi.fn(async()=>({id:`re_${action}`,status:"succeeded"}));
    expect(await runOneProviderAction(transaction,provider)).toBe(true);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider).toHaveBeenCalledWith({paymentIntent:`pi_${payment}`,amountMinor:2200,idempotencyKey:`refund-${action}`});
    expect((await query("SELECT state,attempts FROM provider_actions WHERE id=$1",[action])).rows[0]).toMatchObject({state:"SUCCEEDED",attempts:1});
  });

  it("loads checkout recovery parameters from the locked invoice after active pricing mutates",async()=>{
    const rental=crypto.randomUUID(),invoice=crypto.randomUUID(),attempt=crypto.randomUUID();await query("INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,$3,'PENDING',now(),now()+interval '32 minutes')",[rental,ids.listing,ids.user]);await query("INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,$4,'OPEN',2200,'usd',now()+interval '32 minutes')",[invoice,rental,ids.listing,ids.user]);await query("INSERT INTO stripe_checkout_attempts(id,invoice_id,generation,idempotency_key,status,provider_expires_at) VALUES($1,$2,1,$3,'FAILED',2000000)",[attempt,invoice,`checkout-${attempt}`]);await query("UPDATE pricing SET stripe_weekly_minor=9999,stripe_setup_minor=8888,stripe_currency='eur' WHERE listing_id=$1 AND active",[ids.listing]);
    const recovered=await transaction(db=>loadExistingCheckoutAttempt(db,ids.listing,ids.user));expect(recovered).not.toBeNull();const params=checkoutSessionParameters(recovered!,"https://hermes-dev-2.tallofam.com");expect(params.line_items[0]!.price_data).toMatchObject({unit_amount:2200,currency:"usd"});expect(params.expires_at).toBe(2000000);await query("UPDATE pricing SET stripe_weekly_minor=2000,stripe_setup_minor=200,stripe_currency='usd' WHERE listing_id=$1 AND active",[ids.listing]);await query("DELETE FROM stripe_checkout_attempts WHERE id=$1",[attempt]);await query("DELETE FROM invoices WHERE id=$1",[invoice]);await query("DELETE FROM rentals WHERE id=$1",[rental]);
  });

  it("recovers after provider success and a local completion crash with the same idempotency input",async()=>{
    const invoice=crypto.randomUUID(),payment=crypto.randomUUID(),action=crypto.randomUUID();await query("INSERT INTO invoices(id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'PAID',2200,'usd',now())",[invoice,ids.listing,ids.user]);await query("INSERT INTO payments(id,invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status) VALUES($1,$2,'STRIPE',$3,2200,'usd',2200,'usd','MANUAL_REVIEW')",[payment,invoice,`pi_${payment}`]);await query("INSERT INTO provider_actions(id,kind,state,invoice_id,payment_id,idempotency_key,provider_reference,amount_minor) VALUES($1,'STRIPE_REFUND','QUEUED',$2,$3,$4,$5,2200)",[action,invoice,payment,`refund-${action}`,`pi_${payment}`]);
    const calls:{paymentIntent:string;amountMinor:number;idempotencyKey:string}[]=[];const provider=async(input:{paymentIntent:string;amountMinor:number;idempotencyKey:string})=>{calls.push(input);return{id:`re_${action}`,status:"succeeded"}};let txCall=0;const crashAfterProvider:typeof transaction=async fn=>{txCall++;if(txCall===2)throw new Error("simulated local persistence crash");return transaction(fn)};
    await runOneProviderAction(crashAfterProvider,provider);await query("UPDATE provider_actions SET available_at=now() WHERE id=$1",[action]);await runOneProviderAction(transaction,provider);
    expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);expect((await query("SELECT state,provider_action_id FROM provider_actions WHERE id=$1",[action])).rows[0]).toMatchObject({state:"SUCCEEDED",provider_action_id:`re_${action}`});
  });

  it("runs real worker completion provider-action-first while reconciliation holds that action",async()=>{
    const invoice=crypto.randomUUID(),payment=crypto.randomUUID(),action=crypto.randomUUID();
    await query("INSERT INTO invoices(id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'PAID',2200,'usd',now())",[invoice,ids.listing,ids.user]);
    await query("INSERT INTO payments(id,invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status) VALUES($1,$2,'STRIPE',$3,2200,'usd',2200,'usd','MANUAL_REVIEW')",[payment,invoice,`pi_${payment}`]);
    await query("INSERT INTO provider_actions(id,kind,state,invoice_id,payment_id,idempotency_key,provider_reference,amount_minor) VALUES($1,'STRIPE_REFUND','QUEUED',$2,$3,$4,$5,2200)",[action,invoice,payment,`refund-${action}`,`pi_${payment}`]);
    let releaseProvider!:()=>void;const providerGate=new Promise<void>(resolve=>{releaseProvider=resolve});let providerStarted!:()=>void;const providerCalled=new Promise<void>(resolve=>{providerStarted=resolve});const completionOrder:string[]=[];let txNumber=0;
    const monitoredTx:ProviderTransaction=async fn=>{txNumber++;const completion=txNumber===2;return transaction(db=>fn({query:async<T extends Record<string,unknown>=Record<string,unknown>>(text:string,values?:unknown[])=>{if(completion&&(text.includes("provider_actions")||text.includes("UPDATE payments")))completionOrder.push(text);const result=await db.query<T>(text,values);return{rows:result.rows,rowCount:result.rowCount};}}));};
    const worker=runOneProviderAction(monitoredTx,async()=>{providerStarted();await providerGate;return{id:`re_${action}`,status:"succeeded"}});await providerCalled;
    const operator=await pool().connect();let releaseOperator!:()=>void;const operatorGate=new Promise<void>(resolve=>{releaseOperator=resolve});let actionLocked!:()=>void;const locked=new Promise<void>(resolve=>{actionLocked=resolve});
    try{const operatorDb={query:async<T extends Record<string,unknown>=Record<string,unknown>>(text:string,values?:unknown[])=>{const result=await operator.query<T>(text,values);if(text.includes("provider_actions")){actionLocked();await operatorGate;}return{rows:result.rows,rowCount:result.rowCount};}};const reconciliation=(async()=>{await operator.query("BEGIN");try{await lockPaymentForReconciliation(operatorDb,payment);await operator.query("COMMIT");}catch(error){await operator.query("ROLLBACK");throw error;}})();await locked;releaseProvider();await new Promise(resolve=>setTimeout(resolve,100));expect(completionOrder[0]).toContain("provider_actions");releaseOperator();await expect(reconciliation).rejects.toThrow("REFUND_ACTIVE");await worker;expect((await query("SELECT state FROM provider_actions WHERE id=$1",[action])).rows[0]?.state).toBe("SUCCEEDED");expect((await query("SELECT status FROM payments WHERE id=$1",[payment])).rows[0]?.status).toBe("REFUNDED");}finally{releaseOperator();operator.release();}
  });

  it("runs Stripe refund handling provider-action-first against real worker completion",async()=>{
    const invoice=crypto.randomUUID(),payment=crypto.randomUUID(),action=crypto.randomUUID(),intent=`pi_${crypto.randomUUID()}`,refund=`re_${crypto.randomUUID()}`;
    await query("INSERT INTO invoices(id,listing_id,user_id,status,amount_minor,currency,due_at) VALUES($1,$2,$3,'PAID',2200,'usd',now())",[invoice,ids.listing,ids.user]);
    await query("INSERT INTO payments(id,invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status) VALUES($1,$2,'STRIPE',$3,2200,'usd',2200,'usd','MANUAL_REVIEW')",[payment,invoice,intent]);
    await query("INSERT INTO provider_actions(id,kind,state,invoice_id,payment_id,idempotency_key,provider_reference,amount_minor) VALUES($1,'STRIPE_REFUND','QUEUED',$2,$3,$4,$5,2200)",[action,invoice,payment,`refund-${action}`,intent]);
    let releaseProvider!:()=>void;const providerGate=new Promise<void>(resolve=>{releaseProvider=resolve});let providerStarted!:()=>void;const providerCalled=new Promise<void>(resolve=>{providerStarted=resolve});const worker=runOneProviderAction(transaction,async()=>{providerStarted();await providerGate;return{id:refund,status:"succeeded"}});await providerCalled;
    const stripeOrder:string[]=[];let releaseStripe!:()=>void;const stripeGate=new Promise<void>(resolve=>{releaseStripe=resolve});let stripeLocked!:()=>void;const actionLocked=new Promise<void>(resolve=>{stripeLocked=resolve});
    const stripe=transaction(db=>handleStripeEvent({query:async(text,values)=>{if(text.includes("provider_actions")||text.includes("UPDATE payments")||(text.includes("FROM payments")&&text.includes("FOR UPDATE")))stripeOrder.push(text);const result=await db.query(text,values);if(text.includes("provider_actions")&&text.includes("FOR UPDATE")){stripeLocked();await stripeGate;}return result;}},{id:`evt_${refund}`,type:"refund.updated",data:{object:{id:refund,object:"refund",amount:2200,status:"succeeded",payment_intent:intent}}} as never));
    await actionLocked;releaseProvider();await new Promise(resolve=>setTimeout(resolve,100));releaseStripe();expect(stripeOrder[0]).toContain("provider_actions");expect(await stripe).toBe("COMPLETE");await worker;expect((await query("SELECT status FROM payments WHERE id=$1",[payment])).rows[0]?.status).toBe("REFUNDED");expect((await query("SELECT state FROM provider_actions WHERE id=$1",[action])).rows[0]?.state).toBe("SUCCEEDED");
  });
});
