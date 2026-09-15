import type Stripe from "stripe";
import {settleCheckoutInvoice} from "./checkout";
import {chargePaymentIntentId,disputeChargeId,disputePaymentIntentId,refundChargeId,refundDisposition,refundNote,refundPaymentIntentId,sessionPaymentIntentId} from "./stripe-payments";
interface Queryable{query<T extends Record<string,unknown>=Record<string,unknown>>(text:string,values?:unknown[]):Promise<{rowCount:number|null;rows:T[]}>}
export type StripeHandlingStatus="COMPLETE"|"MANUAL_REVIEW";

export async function handleStripeEvent(db:Queryable,event:Stripe.Event):Promise<StripeHandlingStatus>{
 if(event.type==="checkout.session.expired"||event.type==="checkout.session.async_payment_failed"){
  const session=event.data.object as Stripe.Checkout.Session;
  const invoiceId=session.metadata?.invoiceId;
  const attemptId=session.metadata?.attemptId;
  if(!invoiceId||!attemptId||session.client_reference_id!==invoiceId)throw new Error("missing or mismatched invoice binding");
  const preflight=await db.query<{listing_id:string}>(`SELECT i.listing_id FROM stripe_checkout_attempts a JOIN invoices i ON i.id=a.invoice_id WHERE a.id=$1 AND a.invoice_id=$2 AND a.session_id=$3`,[attemptId,invoiceId,session.id]);
  if(!preflight.rows[0])throw new Error("checkout session is not bound to persisted attempt");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`listing:${preflight.rows[0].listing_id}`]);
  const bound=await db.query<{status:string;rental_id:string|null}>(`SELECT a.status,i.rental_id FROM stripe_checkout_attempts a JOIN invoices i ON i.id=a.invoice_id WHERE a.id=$1 AND a.invoice_id=$2 AND a.session_id=$3 AND a.status IN ('OPEN','EXPIRED') FOR UPDATE OF a,i`,[attemptId,invoiceId,session.id]);
  if(!bound.rows[0])throw new Error("checkout session is not bound to persisted attempt");
  if(bound.rows[0].status==="EXPIRED")return "COMPLETE";
  const expired=await db.query("UPDATE stripe_checkout_attempts SET status='EXPIRED',updated_at=now() WHERE id=$1 AND invoice_id=$2 AND session_id=$3 AND status='OPEN'",[attemptId,invoiceId,session.id]);
  const invoice=await db.query("UPDATE invoices SET status='VOID' WHERE id=$1 AND status='OPEN'",[invoiceId]);
  if(expired.rowCount!==1||invoice.rowCount!==1)throw new Error("checkout expiration state conflict");
  if(bound.rows[0].rental_id)await db.query("UPDATE rentals SET status='CANCELLED' WHERE id=$1 AND status='PENDING'",[bound.rows[0].rental_id]);
  return "COMPLETE";
 }
 if(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded"){
  const session=event.data.object as Stripe.Checkout.Session;
  const invoiceId=session.metadata?.invoiceId;
  const attemptId=session.metadata?.attemptId;
  const reference=sessionPaymentIntentId(session);
  if(!invoiceId||!attemptId||session.client_reference_id!==invoiceId||session.amount_total===null||!session.currency||session.payment_status!=="paid"||!reference)throw new Error("missing, unpaid, or mismatched invoice binding");
  const preflight=await db.query<{listing_id:string;user_id:string}>("SELECT listing_id,user_id FROM invoices WHERE id=$1",[invoiceId]);
  if(!preflight.rows[0])throw new Error("paid charge has unknown invoice");
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`listing:${preflight.rows[0].listing_id}`]);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`user-role:${preflight.rows[0].user_id}`]);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`stripe-payment:${reference}`]);
  const boundAttempt=await db.query("SELECT 1 FROM stripe_checkout_attempts WHERE id=$1 AND invoice_id=$2 AND session_id=$3 AND status IN ('OPEN','COMPLETED') FOR UPDATE",[attemptId,invoiceId,session.id]);
  if(!boundAttempt.rowCount)throw new Error("checkout session is not bound to persisted attempt");

  const duplicate=await db.query<{invoice_id:string;amount_minor:number;currency:string}>(
   "SELECT invoice_id,amount_minor,currency FROM payments WHERE provider='STRIPE' AND provider_reference=$1 FOR UPDATE",
   [reference],
  );
  if(duplicate.rows[0]){
   const paid=duplicate.rows[0];
   if(paid.invoice_id!==invoiceId||paid.amount_minor!==session.amount_total||paid.currency.trim().toLowerCase()!==session.currency.toLowerCase())throw new Error("provider reference payload conflict");
   await db.query("UPDATE stripe_checkout_attempts SET status='COMPLETED',updated_at=now() WHERE session_id=$1",[session.id]);
   return "COMPLETE";
  }

  const eligible=await db.query<{amount_minor:number;currency:string;rental_status:"PENDING"|"ACTIVE"}>(
   `SELECT i.amount_minor,i.currency,r.status rental_status
    FROM invoices i
    JOIN rentals r ON r.id=i.rental_id AND r.listing_id=i.listing_id AND r.user_id=i.user_id
   JOIN users u ON u.id=i.user_id AND u.active AND u.role IN ('RESIDENT','RENTER','ADMINISTRATOR')
    WHERE i.id=$1 AND i.status='OPEN' AND i.due_at>now()
      AND r.status IN ('PENDING','ACTIVE') AND r.ends_at>now()
      AND NOT EXISTS (
        SELECT 1 FROM reservations x
        WHERE x.listing_id=i.listing_id AND x.status='ACTIVE' AND x.expires_at>now()
          AND (r.status='ACTIVE' OR x.target_user_id<>i.user_id)
      )
    FOR UPDATE OF i,r`,
   [invoiceId],
  );
  if(eligible.rowCount){
   await settleCheckoutInvoice(db,{invoiceId,provider:"STRIPE",providerReference:reference,amountMinor:session.amount_total,currency:session.currency});
   await db.query("UPDATE stripe_checkout_attempts SET status='COMPLETED',updated_at=now() WHERE session_id=$1",[session.id]);
   return "COMPLETE";
  }
  const expected=await db.query<{amount_minor:number;currency:string}>("SELECT amount_minor,currency FROM invoices WHERE id=$1 FOR UPDATE",[invoiceId]);if(!expected.rowCount)throw new Error("paid charge has unknown invoice");
  const payment=await db.query<{id:string}>(`INSERT INTO payments(invoice_id,provider,provider_reference,amount_minor,currency,expected_amount_minor,expected_currency,status,reconciliation_note) VALUES($1,'STRIPE',$2,$3,$4,$5,$6,'MANUAL_REVIEW','Paid after hold expiry or state conflict; automatic refund queued') ON CONFLICT(provider,provider_reference) DO NOTHING RETURNING id`,[invoiceId,reference,session.amount_total,session.currency,expected.rows[0]!.amount_minor,expected.rows[0]!.currency]);
  if(!payment.rowCount){const raced=await db.query<{id:string;invoice_id:string;amount_minor:number;currency:string}>("SELECT id,invoice_id,amount_minor,currency FROM payments WHERE provider='STRIPE' AND provider_reference=$1",[reference]);const existing=raced.rows[0];if(!existing||existing.invoice_id!==invoiceId||existing.amount_minor!==session.amount_total||existing.currency.trim().toLowerCase()!==session.currency.toLowerCase())throw new Error("provider reference payload conflict");return "COMPLETE";}
  await db.query(`INSERT INTO provider_actions(kind,state,invoice_id,payment_id,stripe_event_id,idempotency_key,provider_reference,amount_minor) VALUES('STRIPE_REFUND','QUEUED',$1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING`,[invoiceId,payment.rows[0]!.id,event.id,`lte-late-refund-${session.id}`,reference,session.amount_total]);return "MANUAL_REVIEW";
 }
 if(event.type.startsWith("refund.")||event.type==="charge.refunded"){
  const object=event.data.object as Stripe.Refund|Stripe.Charge;let refs:string[]=[];let amountRefunded=0;let refundStatus="pending";const refundId=object.id;
  if(event.type==="charge.refunded"){const charge=object as Stripe.Charge;refs=[chargePaymentIntentId(charge),charge.id].filter((v):v is string=>Boolean(v));amountRefunded=charge.amount_refunded;refundStatus=charge.refunded?"succeeded":"pending";}
  else {const refund=object as Stripe.Refund;refs=[refundPaymentIntentId(refund),refundChargeId(refund)].filter((v):v is string=>Boolean(v));amountRefunded=refund.amount;refundStatus=refund.status??(event.type==="refund.failed"?"failed":"pending");}
  if(!refs.length)throw new Error("refund has no usable provider relationship");
  const candidate=await db.query<{id:string}>("SELECT id FROM payments WHERE provider='STRIPE' AND provider_reference=ANY($1::text[])",[refs]);if(!candidate.rows[0])return "MANUAL_REVIEW";
  await db.query("SELECT id FROM provider_actions WHERE payment_id=$1 AND state<>'RESOLVED' FOR UPDATE",[candidate.rows[0].id]);
  const found=await db.query<{id:string;amount_minor:number}>("SELECT id,amount_minor FROM payments WHERE id=$1 AND provider='STRIPE' AND provider_reference=ANY($2::text[]) FOR UPDATE",[candidate.rows[0].id,refs]);const payment=found.rows[0];if(!payment)return "MANUAL_REVIEW";
  if(event.type!=="charge.refunded"){await db.query(`INSERT INTO payment_refunds(refund_id,payment_id,charge_id,payment_intent_id,amount_minor,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(refund_id) DO UPDATE SET amount_minor=EXCLUDED.amount_minor,status=EXCLUDED.status,updated_at=now()`,[refundId,payment.id,refundChargeId(object as Stripe.Refund),refundPaymentIntentId(object as Stripe.Refund),amountRefunded,refundStatus]);const total=await db.query<{amount:number}>("SELECT COALESCE(sum(amount_minor),0)::int amount FROM payment_refunds WHERE payment_id=$1 AND status='succeeded'",[payment.id]);amountRefunded=total.rows[0]?.amount??0;}
  const disposition=refundDisposition({status:refundStatus,amountRefunded,amountPaid:payment.amount_minor});await db.query("UPDATE payments SET status=$2,reconciliation_note=$3 WHERE id=$1",[payment.id,disposition,refundNote({status:refundStatus,amountRefunded,amountPaid:payment.amount_minor})]);
  await db.query("UPDATE provider_actions SET state=CASE WHEN $2='REFUNDED' THEN 'SUCCEEDED' ELSE state END,provider_action_id=COALESCE(provider_action_id,$3),provider_status=$4,updated_at=now() WHERE payment_id=$1",[payment.id,disposition,refundId,refundStatus]);return disposition==="REFUNDED"?"COMPLETE":"MANUAL_REVIEW";
 }
 if(event.type.startsWith("charge.dispute.")){
  const dispute=event.data.object as Stripe.Dispute;const refs=[disputePaymentIntentId(dispute),disputeChargeId(dispute)].filter((v):v is string=>Boolean(v));if(!refs.length)throw new Error("dispute has no usable provider relationship");const changed=await db.query("UPDATE payments SET status='MANUAL_REVIEW',reconciliation_note=$2 WHERE provider='STRIPE' AND provider_reference=ANY($1::text[])",[refs,`Stripe dispute event ${event.id}`]);return changed.rowCount?"MANUAL_REVIEW":"MANUAL_REVIEW";
 }
 return "COMPLETE";
}
