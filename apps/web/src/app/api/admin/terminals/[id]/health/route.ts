import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { assertBrowserOrigin, noStoreHeaders } from "../../../../../../lib/http";
import { currentViewer } from "../../../../../../lib/auth";
import { env } from "../../../../../../lib/env";
import { can } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { assertBrowserOrigin(req.headers, env().baseUrl); } catch { return NextResponse.json({ error: "Invalid origin" }, { status: 403 }); }
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!can(viewer.role, "terminal:manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = (await params).id;
  const checkId = randomUUID();
  const queued = await transaction(async db => {
    const result = await db.query<{ id: string }>("SELECT id FROM terminals WHERE id=$1 AND enabled FOR UPDATE", [id]);
    if (!result.rowCount) return false;
    await db.query("INSERT INTO terminal_outbound_events(terminal_id,kind,payload) VALUES($1,'HEALTH_CHECK',$2::jsonb)", [id, JSON.stringify({ checkId })]);
    await db.query("UPDATE terminals SET health_status='STALE',health_check_id=$2 WHERE id=$1", [id, checkId]);
    await db.query("INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,'TERMINAL_HEALTH_CHECK','TERMINAL',$2,$3::jsonb)", [viewer.id, id, JSON.stringify({ checkId })]);
    return true;
  });
  if (!queued) return NextResponse.json({ error: "Terminal not found or inactive" }, { status: 404 });
  return NextResponse.json({ queued: true, checkId }, { headers: noStoreHeaders });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await currentViewer();
  if (!viewer || !can(viewer.role, "terminal:manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = (await params).id;
  const result = await transaction(db => db.query<{ health_status: string; health_checked_at: Date | null; health_check_id: string | null }>("SELECT health_status,health_checked_at,health_check_id FROM terminals WHERE id=$1", [id]));
  const row = result.rows[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ status: row.health_status, checkedAt: row.health_checked_at?.toISOString() ?? null, checkId: row.health_check_id }, { headers: noStoreHeaders });
}
