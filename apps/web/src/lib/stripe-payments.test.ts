import {describe,expect,it} from "vitest";
import {chargePaymentIntentId,disputeChargeId,disputePaymentIntentId,refundChargeId,refundPaymentIntentId,sessionPaymentIntentId,refundDisposition} from "./stripe-payments.js";

describe("Stripe expandable identifiers",()=>{
  const object={id:"pi_object"};
  it("normalizes session payment_intent strings and objects",()=>{
    expect(sessionPaymentIntentId({payment_intent:"pi_string"})).toBe("pi_string");
    expect(sessionPaymentIntentId({payment_intent:object})).toBe("pi_object");
    expect(sessionPaymentIntentId({payment_intent:null})).toBeNull();
  });
  it("normalizes refund, charge, and dispute relationships",()=>{
    expect(refundChargeId({charge:{id:"ch_1"}})).toBe("ch_1");
    expect(refundPaymentIntentId({payment_intent:object})).toBe("pi_object");
    expect(chargePaymentIntentId({payment_intent:"pi_2"})).toBe("pi_2");
    expect(disputeChargeId({charge:{id:"ch_2"}})).toBe("ch_2");
    expect(disputePaymentIntentId({payment_intent:{id:"pi_3"}})).toBe("pi_3");
  });
  it("never stringifies malformed objects",()=>{
    expect(refundPaymentIntentId({payment_intent:{foo:"bar"} as unknown as {id?:unknown}})).toBeNull();
  });
});

describe("refund disposition",()=>{
  it.each([
    ["succeeded",1000,1000,"REFUNDED"],
    ["succeeded",250,1000,"MANUAL_REVIEW"],
    ["pending",1000,1000,"MANUAL_REVIEW"],
    ["failed",1000,1000,"MANUAL_REVIEW"],
  ] as const)("maps %s cumulative %i/%i to %s",(status,refunded,paid,want)=>{
    expect(refundDisposition({status,amountRefunded:refunded,amountPaid:paid})).toBe(want);
  });
});
