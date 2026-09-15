import { describe, expect, it } from "vitest";
import { challengeRequestSchema, listingMutationSchema, listingPatchSchema, passwordChangeSchema, rentalAdminSchema, reservationCreateSchema, roleMutationSchema, roleSchema, terminalActionSchema, terminalPaymentSchema } from "./index.js";

describe("contracts", () => {
  it("normalizes an SL username while preserving strict input", () => {
    expect(challengeRequestSchema.parse({ username: "Ava Resident" }).username).toBe("ava resident");
    expect(() => challengeRequestSchema.parse({ username: "x" })).toThrow();
  });
  it("requires the current password and matching replacement confirmation", () => {
    const input = { currentPassword: "old password phrase", password: "new password phrase", confirmation: "new password phrase" };
    expect(passwordChangeSchema.parse(input)).toEqual(input);
    expect(() => passwordChangeSchema.parse({ ...input, confirmation: "different password" })).toThrow();
    expect(() => passwordChangeSchema.parse({ ...input, currentPassword: "too-short" })).toThrow();
  });
  it("requires positive integer L$ amounts and UUID payer IDs", () => {
    const event = { amountLinden: 1000, payerAvatarId: "11111111-1111-4111-8111-111111111111" };
    expect(terminalPaymentSchema.parse(event).amountLinden).toBe(1000);
    expect(listingMutationSchema.parse({ name:"Test Parcel",slug:"test-parcel",kind:"PARCEL",description:"A sufficiently long listing description.",regionName:"Test",areaSqm:1024,prims:234,weeklyLinden:1000,stripeWeekly:"12.34" }).stripeWeekly).toBe("12.34");
    expect(() => terminalPaymentSchema.parse({ ...event, amountLinden: 1.2 })).toThrow();
    const adminAction=rentalAdminSchema.parse({action:"EXTEND",weeks:2});
    expect(adminAction.action==="EXTEND"&&adminAction.weeks).toBe(2);
    expect(() => rentalAdminSchema.parse({action:"EXTEND",weeks:0})).toThrow();
    expect(() => rentalAdminSchema.parse({action:"END"})).toThrow();
    const endAction=rentalAdminSchema.parse({action:"END",reason:"Lease surrendered by renter"});
    expect(endAction.action==="END"&&endAction.reason).toContain("surrendered");
    expect(() => terminalActionSchema.parse({action:"REVOKE"})).toThrow();
    expect(terminalActionSchema.parse({action:"REVOKE",reason:"Object was replaced"}).reason).toContain("replaced");
  });
  it("does not inject create defaults into partial listing patches",()=>{
    expect(listingPatchSchema.parse({published:true})).toEqual({published:true});
    expect(listingPatchSchema.parse({stripeSetup:"4.50"})).toEqual({stripeSetup:"4.50"});
    expect(()=>listingPatchSchema.parse({published:false})).toThrow();
    expect(listingPatchSchema.parse({published:false,reason:"Owner withdrew inventory"}).reason).toContain("withdrew");
    expect(()=>listingPatchSchema.parse({})).toThrow();
  });
  it("accepts only the five application roles and bounded reservation input", () => {
    expect(roleSchema.options).toEqual(["ADMINISTRATOR", "MANAGER", "AGENT", "RENTER", "RESIDENT"]);
    expect(roleMutationSchema.parse({ role: "MANAGER", reason: "Covering estate operations" }).role).toBe("MANAGER");
    expect(() => roleMutationSchema.parse({ role: "ADMIN", reason: "legacy" })).toThrow();
    expect(reservationCreateSchema.parse({
      listingId: "40000000-0000-4000-8000-000000000001",
      targetUserId: "00000000-0000-4000-8000-000000000002",
      expiresAt: "2027-01-02T00:00:00.000Z",
      idempotencyKey: "agent-reservation-0001",
      notes: "Requested during concierge chat",
    }).notes).toContain("concierge");
    expect(() => reservationCreateSchema.parse({
      listingId: crypto.randomUUID(), targetUserId: crypto.randomUUID(), expiresAt: "not-a-date", idempotencyKey: "x",
    })).toThrow();
  });
});
