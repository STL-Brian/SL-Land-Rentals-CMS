import { NextResponse } from "next/server";
import { rentalAdminSchema } from "@lake-tech/contracts";
import { can } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { currentViewer } from "../../../../../lib/auth";
import { assertBrowserOrigin } from "../../../../../lib/http";
import { env } from "../../../../../lib/env";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}) {
  try { assertBrowserOrigin(req.headers,env().baseUrl); } catch { return NextResponse.json({error:"Invalid origin"},{status:403}); }
  const viewer=await currentViewer(); if(!viewer) return NextResponse.json({error:"Authentication required"},{status:401}); if(!can(viewer.role,"rental:manage")) return NextResponse.json({error:"Forbidden"},{status:403});
  const parsed=rentalAdminSchema.safeParse(await req.json().catch(()=>null)); if(!parsed.success)return NextResponse.json({error:"Invalid action"},{status:400});
  const id=(await params).id;
  const changed=await transaction(async db=>{
    const preflight=await db.query<{listing_id:string}>("SELECT listing_id FROM rentals WHERE id=$1",[id]);
    if(!preflight.rows[0])return "NOT_FOUND";
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`listing:${preflight.rows[0].listing_id}`]);
    const locked=await db.query<{status:string;listing_id:string}>("SELECT status,listing_id FROM rentals WHERE id=$1 FOR UPDATE",[id]);
    if(!locked.rowCount)return "NOT_FOUND";
    if(parsed.data.action==="EXTEND" && locked.rows[0]!.status!=="ACTIVE") return "CONFLICT";
    if(parsed.data.action==="EXTEND") { const reservation=await db.query("SELECT 1 FROM reservations WHERE listing_id=$1 AND status='ACTIVE' AND expires_at>now() FOR UPDATE",[locked.rows[0]!.listing_id]); if(reservation.rowCount)return "RESERVATION_CONFLICT"; }
    const update=parsed.data.action==="END"
      ? await db.query("UPDATE rentals SET status='ENDED',ends_at=LEAST(ends_at,now()) WHERE id=$1",[id])
      : await db.query("UPDATE rentals SET ends_at=GREATEST(ends_at,now())+($2*interval '7 days') WHERE id=$1 AND status='ACTIVE'",[id,parsed.data.weeks]);
    if(update.rowCount!==1)return "CONFLICT";
    await db.query("INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,$2,'RENTAL',$3,$4::jsonb)",[viewer.id,parsed.data.action,id,JSON.stringify(parsed.data)]);
    return "UPDATED";
  });
  if(changed==="NOT_FOUND")return NextResponse.json({error:"Not found"},{status:404});
  if(changed==="CONFLICT")return NextResponse.json({error:"Only active rentals may be extended"},{status:409});
  if(changed==="RESERVATION_CONFLICT")return NextResponse.json({error:"Reserved properties cannot be extended"},{status:409});
  return NextResponse.json({updated:true});
}
