import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalTerminalSignature, sealTerminalSecret } from "@lake-tech/core";
import { pool, query } from "@lake-tech/db";
import { GET as pollTerminal } from "../app/api/terminal/poll/route.js";
import { POST as payTerminal } from "../app/api/terminal/payment/route.js";

const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite("reserved terminal allocation (PostgreSQL)", () => {
  const encryptionKey = process.env.TERMINAL_SECRET_ENCRYPTION_KEY!;
  const terminalSecret = "terminal-route-test-secret-with-32-chars";
  const ids = {
    target: crypto.randomUUID(), other: crypto.randomUUID(), agent: crypto.randomUUID(),
    targetAvatar: crypto.randomUUID(), otherAvatar: crypto.randomUUID(), property: crypto.randomUUID(),
    listing: crypto.randomUUID(), terminal: crypto.randomUUID(), object: crypto.randomUUID(), owner: crypto.randomUUID(),
  };

  beforeAll(async () => {
    await query("INSERT INTO users(id,display_name,role) VALUES($1,'Terminal target','RESIDENT'),($2,'Terminal other','RESIDENT'),($3,'Terminal agent','AGENT')", [ids.target, ids.other, ids.agent]);
    await query("INSERT INTO sl_identities(avatar_id,user_id,canonical_username,display_name) VALUES($1,$2,$3,'Terminal target'),($4,$5,$6,'Terminal other')", [ids.targetAvatar, ids.target, `target.${ids.target}`, ids.otherAvatar, ids.other, `other.${ids.other}`]);
    await query("INSERT INTO properties(id,name,region_name) VALUES($1,'Terminal reserved','Terminal reserved')", [ids.property]);
    await query("INSERT INTO listings(id,property_id,slug,name,kind,description,area_sqm,prims,published) VALUES($1,$2,$3,'Terminal reserved parcel','PARCEL','Terminal reservation integration listing',512,100,true)", [ids.listing, ids.property, `terminal-reserved-${ids.listing}`]);
    await query("INSERT INTO pricing(listing_id,weekly_linden,setup_linden,stripe_weekly_minor) VALUES($1,1000,100,500)", [ids.listing]);
    await query("INSERT INTO terminals(id,listing_id,object_id,owner_id,shard,secret_ciphertext) VALUES($1,$2,$3,$4,'Second Life',$5)", [ids.terminal, ids.listing, ids.object, ids.owner, sealTerminalSecret(terminalSecret, encryptionKey)]);
    await query("INSERT INTO reservations(listing_id,target_user_id,created_by_user_id,expires_at,notes,idempotency_key,request_fingerprint) VALUES($1,$2,$3,now()+interval '1 hour','terminal test',$4,$5)", [ids.listing, ids.target, ids.agent, crypto.randomUUID(), "a".repeat(64)]);
  });

  afterAll(async () => {
    await query("DELETE FROM terminal_outbound_events WHERE terminal_id=$1", [ids.terminal]);
    await query("DELETE FROM terminal_payment_events WHERE terminal_id=$1", [ids.terminal]);
    await query("DELETE FROM terminal_nonces WHERE terminal_id=$1", [ids.terminal]);
    await query("DELETE FROM payments WHERE invoice_id IN (SELECT id FROM invoices WHERE listing_id=$1)", [ids.listing]);
    await query("DELETE FROM invoices WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM rentals WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM reservations WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM terminals WHERE id=$1", [ids.terminal]);
    await query("DELETE FROM pricing WHERE listing_id=$1", [ids.listing]);
    await query("DELETE FROM listings WHERE id=$1", [ids.listing]);
    await query("DELETE FROM properties WHERE id=$1", [ids.property]);
    await query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ids.target, ids.other, ids.agent]]);
    await pool().end();
  });

  function terminalRequest(method: "GET" | "POST", eventId: string, nonce: string, body = "") {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = canonicalTerminalSignature({ timestamp, nonce, eventId, body }, terminalSecret);
    return new Request(`http://localhost/api/terminal/${method === "GET" ? "poll?sequence=0" : "payment"}`, {
      method,
      body: method === "POST" ? body : undefined,
      headers: {
        "x-sl-timestamp": timestamp, "x-sl-nonce": nonce, "x-sl-event-id": eventId,
        "x-sl-object-id": ids.object, "x-sl-owner-id": ids.owner,
        "x-sl-shard": "Second Life", "x-sl-signature": signature,
      },
    });
  }

  it("hides the pay price while a live reservation exists", async () => {
    const response = await pollTerminal(terminalRequest("GET", "poll-reserved", crypto.randomUUID()));
    expect(response.status).toBe(200);
    expect((await response.json()).payPrice).toBe(0);
  });

  it("routes inactive, manager, and agent target payments to manual review without activation", async () => {
    for (const state of [
      { active: false, role: "RESIDENT" },
      { active: true, role: "MANAGER" },
      { active: true, role: "AGENT" },
    ]) {
      await query("UPDATE users SET active=$2,role=$3::user_role WHERE id=$1", [ids.target, state.active, state.role]);
      const body = JSON.stringify({ payerAvatarId: ids.targetAvatar, amountLinden: 1100 });
      const response = await payTerminal(terminalRequest("POST", `pay-ineligible-${state.role}-${state.active}`, crypto.randomUUID(), body));
      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe("MANUAL_REVIEW");
      expect((await query("SELECT count(*)::int n FROM rentals WHERE listing_id=$1 AND status='ACTIVE'", [ids.listing])).rows[0]?.n).toBe(0);
    }
    await query("UPDATE users SET active=true,role='RESIDENT' WHERE id=$1", [ids.target]);
  });

  it("reviews a non-target payment, then starts only for the target and consumes the reservation", async () => {
    const otherBody = JSON.stringify({ payerAvatarId: ids.otherAvatar, amountLinden: 1100 });
    const otherResponse = await payTerminal(terminalRequest("POST", "pay-other", crypto.randomUUID(), otherBody));
    expect(otherResponse.status).toBe(200);
    expect((await otherResponse.json()).status).toBe("MANUAL_REVIEW");
    expect((await query("SELECT count(*)::int n FROM rentals WHERE listing_id=$1 AND status='ACTIVE'", [ids.listing])).rows[0]?.n).toBe(0);

    const targetBody = JSON.stringify({ payerAvatarId: ids.targetAvatar, amountLinden: 1100 });
    const targetResponse = await payTerminal(terminalRequest("POST", "pay-target", crypto.randomUUID(), targetBody));
    expect(targetResponse.status).toBe(200);
    expect((await targetResponse.json()).status).toBe("CONFIRMED");
    expect((await query("SELECT user_id FROM rentals WHERE listing_id=$1 AND status='ACTIVE'", [ids.listing])).rows[0]?.user_id).toBe(ids.target);
    expect((await query("SELECT role FROM users WHERE id=$1", [ids.target])).rows[0]?.role).toBe("RENTER");
    expect((await query("SELECT status FROM reservations WHERE listing_id=$1", [ids.listing])).rows[0]?.status).toBe("COMPLETED");
  });
});
