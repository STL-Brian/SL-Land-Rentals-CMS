export type CheckoutSessionDecision="REUSE"|"AWAIT_WEBHOOK"|"REPLACE";
export function checkoutSessionDecision(session:{status:string|null}):CheckoutSessionDecision{if(session.status==="open")return"REUSE";if(session.status==="complete")return"AWAIT_WEBHOOK";return"REPLACE"}
export function stripeCheckoutExpiresAt(nowMs=Date.now()):number{return Math.floor(nowMs/1000)+31*60}
