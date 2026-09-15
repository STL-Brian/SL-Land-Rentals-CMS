import {afterAll,beforeAll,describe,expect,it} from "vitest";import {query} from "@lake-tech/db";import {claimStripeEvent,failStripeEvent} from "./stripe-events.js";
const enabled=Boolean(process.env.DATABASE_URL);(enabled?describe:describe.skip)("Stripe event claim state machine (PostgreSQL)",()=>{const id=`evt_${crypto.randomUUID()}`;const digest="a".repeat(64);beforeAll(async()=>{await query("DELETE FROM stripe_events WHERE event_id=$1",[id])});afterAll(async()=>{await query("DELETE FROM stripe_events WHERE event_id=$1",[id])});
 it("retries failure and expired leases while completed duplicates are final",async()=>{
  expect(await claimStripeEvent({eventId:id,eventType:"charge.refunded",digest,payload:{id},leaseSeconds:60})).toBe("CLAIMED");
  expect(await claimStripeEvent({eventId:id,eventType:"charge.refunded",digest,payload:{id},leaseSeconds:60})).toBe("BUSY");
  await failStripeEvent(id,new Error("first attempt failed"));
  expect(await claimStripeEvent({eventId:id,eventType:"charge.refunded",digest,payload:{id}})).toBe("CLAIMED");
  await query("UPDATE stripe_events SET processing_status='FAILED',lease_expires_at=now()-interval '1 second' WHERE event_id=$1",[id]);
  expect(await claimStripeEvent({eventId:id,eventType:"charge.refunded",digest,payload:{id}})).toBe("CLAIMED");
  await query("UPDATE stripe_events SET processing_status='COMPLETE',lease_expires_at=NULL WHERE event_id=$1",[id]);
  expect(await claimStripeEvent({eventId:id,eventType:"charge.refunded",digest,payload:{id}})).toBe("COMPLETE");
  expect(await claimStripeEvent({eventId:id,eventType:"refund.failed",digest,payload:{id}})).toBe("CONFLICT");
 });
 it("serializes two synchronized clients claiming the same event",async()=>{const concurrentId=`evt_${crypto.randomUUID()}`;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve});const claimant=async()=>{await barrier;return claimStripeEvent({eventId:concurrentId,eventType:"checkout.session.completed",digest,payload:{id:concurrentId},leaseSeconds:60})};const first=claimant(),second=claimant();release();const outcomes=await Promise.all([first,second]);expect(outcomes.sort()).toEqual(["BUSY","CLAIMED"]);await query("DELETE FROM stripe_events WHERE event_id=$1",[concurrentId]);});
});
