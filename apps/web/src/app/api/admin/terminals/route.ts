import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { can, sealTerminalSecret } from "@lake-tech/core";
import { query, transaction } from "@lake-tech/db";
import { currentViewer } from "../../../../lib/auth";
import { env } from "../../../../lib/env";
import { assertBrowserOrigin, noStoreHeaders } from "../../../../lib/http";
import { parseTerminalProvision } from "../../../../lib/terminal-provision";

export async function GET(): Promise<NextResponse> {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!can(viewer.role, "terminal:manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const result = await query(`SELECT t.id,t.listing_id,t.object_id,t.shard,t.enabled,t.last_seen_at,t.created_at,l.name AS listing_name FROM terminals t JOIN listings l ON l.id=t.listing_id WHERE t.enabled ORDER BY t.created_at DESC`);
  return NextResponse.json({ terminals: result.rows }, { headers: noStoreHeaders });
}

export async function POST(req: Request) {
  const cfg = env();
  try { assertBrowserOrigin(req.headers, cfg.baseUrl); } catch { return NextResponse.json({ error: "Invalid origin" }, { status: 403 }); }
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!can(viewer.role, "terminal:manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let binding;
  try { binding = parseTerminalProvision(await req.json().catch(() => null)); }
  catch { return NextResponse.json({ error: "Invalid terminal binding" }, { status: 400 }); }
  const secret = randomBytes(32).toString("base64url");
  const ciphertext = sealTerminalSecret(secret, cfg.terminalEncryptionKey);
  let terminal;
  try {
    terminal = await transaction(async (db) => {
      const inserted = await db.query<{id:string}>(`INSERT INTO terminals(listing_id,object_id,owner_id,shard,secret_ciphertext) VALUES($1,$2,$3,$4,$5) RETURNING id`, [binding.listingId, binding.objectId, binding.ownerId, binding.shard, ciphertext]);
      const id = inserted.rows[0]!.id;
      await db.query(`INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,'TERMINAL_PROVISION','TERMINAL',$2,$3::jsonb)`, [viewer.id, id, JSON.stringify(binding)]);
      return id;
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return NextResponse.json({ error: "That object is already paired. Use Manage on the existing terminal or choose a different object." }, { status: 409, headers: noStoreHeaders });
    return NextResponse.json({ error: "Terminal pairing failed." }, { status: 500, headers: noStoreHeaders });
  }
  // The plaintext exists only in this one no-store response. It is never logged or persisted.
  return NextResponse.json({ id: terminal, secret }, { status: 201, headers: noStoreHeaders });
}
