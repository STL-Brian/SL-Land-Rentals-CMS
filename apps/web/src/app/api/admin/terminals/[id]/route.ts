import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { terminalActionSchema } from "@lake-tech/contracts";
import { can, sealTerminalSecret } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { currentViewer } from "../../../../../lib/auth";
import { env } from "../../../../../lib/env";
import { assertBrowserOrigin, noStoreHeaders } from "../../../../../lib/http";

export async function PATCH(req: Request, { params }: { params: Promise<{id:string}> }) {
  const cfg = env();
  try { assertBrowserOrigin(req.headers, cfg.baseUrl); } catch { return NextResponse.json({ error: "Invalid origin" }, { status: 403 }); }
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!can(viewer.role, "terminal:manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = terminalActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const id = (await params).id;
  let secret: string | undefined;
  const changed = await transaction(async (db) => {
    if (parsed.data.action === "ROTATE") {
      secret = randomBytes(32).toString("base64url");
      const r = await db.query("UPDATE terminals SET secret_ciphertext=$2,enabled=true WHERE id=$1", [id, sealTerminalSecret(secret, cfg.terminalEncryptionKey)]);
      if (!r.rowCount) return false;
    } else if (parsed.data.action === "REVOKE") {
      const r = await db.query("DELETE FROM terminals WHERE id=$1 AND enabled RETURNING id", [id]); if (!r.rowCount) return false;
    } else {
      const r = await db.query("UPDATE terminals SET listing_id=$2 WHERE id=$1 AND enabled", [id, parsed.data.listingId]); if (!r.rowCount) return false;
    }
    await db.query("INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,'TERMINAL',$3,$4::jsonb)", [viewer.id, `TERMINAL_${parsed.data.action}`, id, JSON.stringify(parsed.data)]);
    return true;
  });
  if (!changed) return NextResponse.json({ error: "Terminal not found or inactive" }, { status: 404 });
  return NextResponse.json(secret ? { updated: true, secret } : { updated: true }, { headers: noStoreHeaders });
}
