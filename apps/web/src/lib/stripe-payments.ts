type Expandable={id?:unknown}|string|null|undefined;
function expandableId(value:Expandable):string|null {
  if(typeof value==="string" && value.length>0)return value;
  if(value && typeof value==="object" && typeof value.id==="string" && value.id.length>0)return value.id;
  return null;
}
type Related={payment_intent?:Expandable;charge?:Expandable};
export const sessionPaymentIntentId=(value:Related)=>expandableId(value.payment_intent);
export const refundPaymentIntentId=(value:Related)=>expandableId(value.payment_intent);
export const refundChargeId=(value:Related)=>expandableId(value.charge);
export const chargePaymentIntentId=(value:Related)=>expandableId(value.payment_intent);
export const disputeChargeId=(value:Related)=>expandableId(value.charge);
export const disputePaymentIntentId=(value:Related)=>expandableId(value.payment_intent);

export function refundDisposition(input:{status:string;amountRefunded:number;amountPaid:number}):"REFUNDED"|"MANUAL_REVIEW" {
  return input.status==="succeeded" && input.amountPaid>0 && input.amountRefunded>=input.amountPaid ? "REFUNDED":"MANUAL_REVIEW";
}

export function refundNote(input:{status:string;amountRefunded:number;amountPaid:number;currency?:string|null}):string {
  return `Stripe refund ${input.status}; cumulative ${input.amountRefunded}/${input.amountPaid} ${input.currency??"unknown"}`;
}
