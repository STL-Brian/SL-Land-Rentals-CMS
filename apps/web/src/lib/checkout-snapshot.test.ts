import{describe,expect,it}from"vitest";
import{checkoutSessionParameters,type ExistingCheckoutAttempt}from"./checkout-attempt.js";

describe("immutable checkout request snapshots",()=>{
 it("reconstructs byte-identical provider parameters from invoice values after pricing changes",()=>{
  const attempt:ExistingCheckoutAttempt={invoiceId:"invoice-1",rentalId:"rental-1",listingId:"listing-1",name:"Parcel",amountMinor:2200,currency:"usd",attemptId:"attempt-1",idempotencyKey:"lte-checkout-invoice-1-1",sessionId:null,sessionUrl:null,providerExpiresAt:2_000_000,rentalStatus:"PENDING"};
  const first=checkoutSessionParameters(attempt,"https://hermes-dev-2.tallofam.com");
  const activePricingAfterMutation={stripeWeeklyMinor:9999,stripeSetupMinor:8888,currency:"eur"};
  expect(activePricingAfterMutation).not.toMatchObject({stripeWeeklyMinor:attempt.amountMinor,currency:attempt.currency});
  const recovered=checkoutSessionParameters({...attempt},"https://hermes-dev-2.tallofam.com");
  expect(JSON.stringify(recovered)).toBe(JSON.stringify(first));
  expect(first.line_items[0]?.price_data).toMatchObject({unit_amount:2200,currency:"usd"});
  expect(first.expires_at).toBe(2_000_000);
 });
});
