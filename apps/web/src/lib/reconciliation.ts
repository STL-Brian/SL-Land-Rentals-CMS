import type Stripe from "stripe";
import {handleStripeEvent} from "./stripe-event-handler";

export interface Queryable{query<T extends Record<string,unknown>=Record<string,unknown>>(text:string,values?:unknown[]):Promise<{rowCount:number|null;rows:T[]}>}
async function audit(db:Queryable,actor:string,action:string,target:string,note:string){await db.query("INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,'RECONCILIATION',$3,$4::jsonb)",[actor,action,target,JSON.stringify({note})]);}

export async function lockPaymentForReconciliation(db:Queryable,id:string):Promise<{invoice_id:string;provider:string;user_id:string;listing_id:string}>{
 const actions=await db.query<{state:string}>("SELECT state FROM provider_actions WHERE payment_id=$1 AND state<>'RESOLVED' FOR UPDATE",[id]);
 if(actions.rowCount)throw new Error("REFUND_ACTIVE");
 const locked=await db.query<{invoice_id:string;provider:string;user_id:string;listing_id:string}>("SELECT p.invoice_id,p.provider,i.user_id,i.listing_id FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.id=$1 AND p.status='MANUAL_REVIEW' FOR UPDATE OF p,i",[id]);
 if(!locked.rows[0])throw new Error("MISSING");
 return locked.rows[0];
}

export async function retryProviderAction(db:Queryable,id:string,actor:string,note:string):Promise<void>{
 const locked=await db.query<{state:string}>("SELECT state FROM provider_actions WHERE id=$1 FOR UPDATE",[id]);
 if(!locked.rowCount)throw new Error("MISSING");
 if(!["FAILED","MANUAL_REVIEW"].includes(locked.rows[0]!.state))throw new Error("STATE_CONFLICT");
 const changed=await db.query("UPDATE provider_actions SET state='QUEUED',attempts=0,available_at=now(),lease_expires_at=NULL,last_error=NULL,resolved_by=NULL,resolved_at=NULL,updated_at=now() WHERE id=$1 AND state IN ('FAILED','MANUAL_REVIEW')",[id]);
 if(changed.rowCount!==1)throw new Error("STATE_CONFLICT");
 await audit(db,actor,"PROVIDER_ACTION_RETRY",`provider-action:${id}`,note);
}
export async function resolveProviderAction(db:Queryable,id:string,actor:string,note:string):Promise<void>{
 const locked=await db.query<{state:string}>("SELECT state FROM provider_actions WHERE id=$1 FOR UPDATE",[id]);
 if(!locked.rowCount)throw new Error("MISSING");
 if(!["FAILED","MANUAL_REVIEW"].includes(locked.rows[0]!.state))throw new Error("STATE_CONFLICT");
 const changed=await db.query("UPDATE provider_actions SET state='RESOLVED',resolved_by=$2,resolved_at=now(),lease_expires_at=NULL,last_error=$3,updated_at=now() WHERE id=$1 AND state IN ('FAILED','MANUAL_REVIEW')",[id,actor,note]);
 if(changed.rowCount!==1)throw new Error("STATE_CONFLICT");
 await audit(db,actor,"PROVIDER_ACTION_RESOLVE",`provider-action:${id}`,note);
}
export async function retryStripeEvent(db:Queryable,eventId:string,actor:string,note:string):Promise<void>{
 const found=await db.query<{payload:unknown;processing_status:string;lease_expires_at:Date|null}>("SELECT payload,processing_status,lease_expires_at FROM stripe_events WHERE event_id=$1 FOR UPDATE",[eventId]);
 if(!found.rowCount)throw new Error("MISSING");const row=found.rows[0]!;
 const retryable=row.processing_status==="FAILED"||row.processing_status==="MANUAL_REVIEW"||(row.processing_status==="PROCESSING"&&row.lease_expires_at!==null&&row.lease_expires_at<=new Date());
 if(!retryable)throw new Error("STATE_CONFLICT");if(!row.payload)throw new Error("NO_PAYLOAD");
 const claimed=await db.query("UPDATE stripe_events SET processing_status='PROCESSING',attempts=attempts+1,lease_expires_at=now()+interval '2 minutes',processing_note=NULL,updated_at=now() WHERE event_id=$1 AND (processing_status IN ('FAILED','MANUAL_REVIEW') OR (processing_status='PROCESSING' AND lease_expires_at<=now()))",[eventId]);
 if(claimed.rowCount!==1)throw new Error("STATE_CONFLICT");
 const status=await handleStripeEvent(db,row.payload as Stripe.Event);
 const completed=await db.query("UPDATE stripe_events SET processing_status=$2,processing_note=$3,lease_expires_at=NULL,processed_at=now(),updated_at=now() WHERE event_id=$1 AND processing_status='PROCESSING'",[eventId,status,note]);
 if(completed.rowCount!==1)throw new Error("STATE_CONFLICT");
 await audit(db,actor,"STRIPE_EVENT_RETRY",eventId,note);
}
export async function resolveStripeEvent(db:Queryable,eventId:string,actor:string,note:string):Promise<void>{
 const locked=await db.query<{processing_status:string;lease_expires_at:Date|null}>("SELECT processing_status,lease_expires_at FROM stripe_events WHERE event_id=$1 FOR UPDATE",[eventId]);
 if(!locked.rowCount)throw new Error("MISSING");const row=locked.rows[0]!;
 const resolvable=row.processing_status==="FAILED"||row.processing_status==="MANUAL_REVIEW"||(row.processing_status==="PROCESSING"&&row.lease_expires_at!==null&&row.lease_expires_at<=new Date());
 if(!resolvable)throw new Error("STATE_CONFLICT");
 const changed=await db.query("UPDATE stripe_events SET processing_status='COMPLETE',processing_note=$2,lease_expires_at=NULL,processed_at=now(),updated_at=now() WHERE event_id=$1 AND (processing_status IN ('FAILED','MANUAL_REVIEW') OR (processing_status='PROCESSING' AND lease_expires_at<=now()))",[eventId,note]);
 if(changed.rowCount!==1)throw new Error("STATE_CONFLICT");await audit(db,actor,"STRIPE_EVENT_RESOLVE",eventId,note);
}
