import { NextResponse } from "next/server";
import { query } from "@lake-tech/db";
import { currentViewer } from "../../../../../lib/auth";
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){const viewer=await currentViewer();if(!viewer)return NextResponse.json({error:"Authentication required"},{status:401});if(viewer.role!=="RENTER")return NextResponse.json({error:"Forbidden"},{status:403});const id=(await params).id;const found=await query(`SELECT r.id,r.status,r.starts_at,r.ends_at,l.name FROM rentals r JOIN listings l ON l.id=r.listing_id WHERE r.id=$1 AND r.user_id=$2`,[id,viewer.id]);if(!found.rowCount)return NextResponse.json({error:"Not found"},{status:404});return NextResponse.json(found.rows[0])}
