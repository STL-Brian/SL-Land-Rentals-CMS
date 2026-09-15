export interface ExistingCheckoutAttempt {
  invoiceId:string;
  rentalId:string;
  listingId:string;
  name:string;
  amountMinor:number;
  currency:string;
  attemptId:string;
  idempotencyKey:string;
  sessionId:string|null;
  sessionUrl:string|null;
  providerExpiresAt:number;
  rentalStatus:"PENDING"|"ACTIVE";
}

interface Queryable{query<T extends Record<string,unknown>=Record<string,unknown>>(sql:string,values?:unknown[]):Promise<{rows:T[];rowCount:number|null}>}
type ExistingRow={invoice_id:string;rental_id:string;listing_id:string;name:string;amount_minor:number;currency:string;attempt_id:string;idempotency_key:string;session_id:string|null;session_url:string|null;provider_expires_at:string|number;rental_status:"PENDING"|"ACTIVE"};
const mapAttempt=(r:ExistingRow|undefined):ExistingCheckoutAttempt|null=>r?{invoiceId:r.invoice_id,rentalId:r.rental_id,listingId:r.listing_id,name:r.name,amountMinor:r.amount_minor,currency:r.currency.trim().toLowerCase(),attemptId:r.attempt_id,idempotencyKey:r.idempotency_key,sessionId:r.session_id,sessionUrl:r.session_url,providerExpiresAt:Number(r.provider_expires_at),rentalStatus:r.rental_status}:null;
const columns=`SELECT i.id invoice_id,r.id rental_id,l.id listing_id,l.name,i.amount_minor,i.currency,a.id attempt_id,a.idempotency_key,a.session_id,a.session_url,a.provider_expires_at,r.status rental_status FROM rentals r JOIN invoices i ON i.rental_id=r.id AND i.status='OPEN' JOIN listings l ON l.id=r.listing_id JOIN stripe_checkout_attempts a ON a.invoice_id=i.id AND a.status IN ('CREATING','OPEN','FAILED')`;
export async function loadExistingCheckoutAttempt(db:Queryable,listingId:string,userId:string):Promise<ExistingCheckoutAttempt|null>{const found=await db.query<ExistingRow>(`${columns} WHERE r.listing_id=$1 AND r.user_id=$2 AND r.status='PENDING' AND r.ends_at>now() ORDER BY a.generation DESC LIMIT 1 FOR UPDATE OF r,i,a`,[listingId,userId]);return mapAttempt(found.rows[0]);}
export async function loadExistingRenewalAttempt(db:Queryable,rentalId:string,userId:string):Promise<ExistingCheckoutAttempt|null>{const found=await db.query<ExistingRow>(`${columns} WHERE r.id=$1 AND r.user_id=$2 AND r.status='ACTIVE' AND r.ends_at>now() ORDER BY a.generation DESC LIMIT 1 FOR UPDATE OF r,i,a`,[rentalId,userId]);return mapAttempt(found.rows[0]);}

export function checkoutSessionParameters(attempt:ExistingCheckoutAttempt,baseUrl:string){
  return {
    mode:"payment" as const,
    managed_payments:{enabled:false},
    expires_at:attempt.providerExpiresAt,
    line_items:[{quantity:1,price_data:{currency:attempt.currency,unit_amount:attempt.amountMinor,product_data:{name:`${attempt.name} — ${attempt.rentalStatus==="ACTIVE"?"one-week renewal":"first week and setup"}`}}}],
    client_reference_id:attempt.invoiceId,
    metadata:{invoiceId:attempt.invoiceId,attemptId:attempt.attemptId},
    success_url:`${baseUrl}/checkout/success?invoice=${attempt.invoiceId}`,
    cancel_url:`${baseUrl}/rentals`,
  };
}
