import { NextResponse } from "next/server";
import { can } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { currentViewer } from "../../../../lib/auth";
import { env } from "../../../../lib/env";
import { assertBrowserOrigin } from "../../../../lib/http";
import { assertEligibleRentalUser } from "../../../../lib/rental-eligibility";

export async function POST(req: Request) {
  try { assertBrowserOrigin(req.headers, env().baseUrl); }
  catch { return NextResponse.json({ error: "Invalid origin" }, { status: 403 }); }
  const viewer=await currentViewer();
  if(!viewer)return NextResponse.json({error:"Authentication required"},{status:401});
  if(!can(viewer.role,"rental:manage"))return NextResponse.json({error:"Forbidden"},{status:403});
  const body=await req.json() as {invoiceId?:string;weeks?:number};
  if(!body.invoiceId||!Number.isInteger(body.weeks)||body.weeks!<1||body.weeks!>52) {
    return NextResponse.json({error:"Invalid activation"},{status:400});
  }
  try {
    const id=await transaction(async db=>{
      const preflight=await db.query<{listing_id:string}>(
        "SELECT listing_id FROM invoices WHERE id=$1 AND status='PAID' AND rental_id IS NULL",
        [body.invoiceId],
      );
      if(!preflight.rows[0])throw new Error("invoice unavailable");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`listing:${preflight.rows[0].listing_id}`]);
      const inv=await db.query<{listing_id:string;user_id:string}>(
        "SELECT listing_id,user_id FROM invoices WHERE id=$1 AND status='PAID' AND rental_id IS NULL FOR UPDATE",
        [body.invoiceId],
      );
      const invoice=inv.rows[0];if(!invoice)throw new Error("invoice unavailable");
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`user-role:${invoice.user_id}`]);
      await assertEligibleRentalUser(db, invoice.user_id);
      await db.query("UPDATE reservations SET status='EXPIRED' WHERE listing_id=$1 AND status='ACTIVE' AND expires_at<=now()",[invoice.listing_id]);
      const reservation=await db.query<{id:string;target_user_id:string}>(
        "SELECT id,target_user_id FROM reservations WHERE listing_id=$1 AND status='ACTIVE' AND expires_at>now() FOR UPDATE",
        [invoice.listing_id],
      );
      if(reservation.rows[0]&&reservation.rows[0].target_user_id!==invoice.user_id)throw new Error("reservation conflict");
      const occupied=await db.query("SELECT id FROM rentals WHERE listing_id=$1 AND status='ACTIVE' AND ends_at>now() FOR UPDATE",[invoice.listing_id]);
      if(occupied.rowCount)throw new Error("occupied");
      const rental=await db.query<{id:string}>(
        "INSERT INTO rentals(listing_id,user_id,status,starts_at,ends_at) VALUES($1,$2,'ACTIVE',now(),now()+($3*interval '7 days')) RETURNING id",
        [invoice.listing_id,invoice.user_id,body.weeks],
      );
      await db.query("UPDATE users SET role='RENTER' WHERE id=$1 AND role='RESIDENT'",[invoice.user_id]);
      if(reservation.rows[0]) {
        const consumed=await db.query("UPDATE reservations SET status='COMPLETED' WHERE id=$1 AND status='ACTIVE'",[reservation.rows[0].id]);
        if(consumed.rowCount!==1)throw new Error("reservation conflict");
      }
      await db.query("UPDATE invoices SET rental_id=$1 WHERE id=$2 AND rental_id IS NULL",[rental.rows[0]!.id,body.invoiceId]);
      await db.query("INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,'ACTIVATE','RENTAL',$2,$3::jsonb)",[viewer.id,rental.rows[0]!.id,JSON.stringify({invoiceId:body.invoiceId,weeks:body.weeks})]);
      return rental.rows[0]!.id;
    });
    return NextResponse.json({id},{status:201});
  } catch {
    return NextResponse.json({error:"Invoice cannot be activated"},{status:409});
  }
}
