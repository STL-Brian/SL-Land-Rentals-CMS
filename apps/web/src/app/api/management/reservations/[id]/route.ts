import { NextResponse } from "next/server";
import { reservationCancelSchema } from "@lake-tech/contracts";
import { authorizeApi } from "../../../../../lib/authorization";
import { assertBrowserOrigin } from "../../../../../lib/http";
import { env } from "../../../../../lib/env";
import { cancelReservation } from "../../../../../lib/reservations";
export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){try{assertBrowserOrigin(req.headers,env().baseUrl)}catch{return NextResponse.json({error:"Invalid origin"},{status:403})}const auth=await authorizeApi("reservation:manage");if(auth.response)return auth.response;const parsed=reservationCancelSchema.safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Invalid cancellation"},{status:400});try{await cancelReservation(auth.viewer.id,(await params).id,parsed.data.reason);return NextResponse.json({cancelled:true})}catch(error){const code=error instanceof Error?error.message:"FAILED";return NextResponse.json({error:code==="NOT_FOUND"?"Reservation not found":"Cancellation denied"},{status:code==="NOT_FOUND"?404:403})}}
