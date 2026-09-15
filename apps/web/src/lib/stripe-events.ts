import {transaction} from "@lake-tech/db";
export type StripeClaim="CLAIMED"|"COMPLETE"|"BUSY"|"CONFLICT";
export async function claimStripeEvent(input:{eventId:string;eventType:string;digest:string;payload:unknown;leaseSeconds?:number}):Promise<StripeClaim>{
  const lease=input.leaseSeconds??120;
  return transaction(async db=>{
    const inserted=await db.query(`INSERT INTO stripe_events(event_id,event_type,payload_sha256,payload,processing_status,attempts,lease_expires_at,updated_at)
      VALUES($1,$2,$3,$4::jsonb,'PROCESSING',1,now()+($5||' seconds')::interval,now()) ON CONFLICT DO NOTHING RETURNING event_id`,[input.eventId,input.eventType,input.digest,JSON.stringify(input.payload),String(lease)]);
    if(inserted.rowCount)return "CLAIMED";
    const row=await db.query<{event_type:string;payload_sha256:string;processing_status:string;lease_expires_at:Date|null}>("SELECT event_type,payload_sha256,processing_status,lease_expires_at FROM stripe_events WHERE event_id=$1 FOR UPDATE",[input.eventId]);
    const current=row.rows[0];
    if(!current||current.event_type!==input.eventType||current.payload_sha256!==input.digest)return "CONFLICT";
    if(current.processing_status==="COMPLETE")return "COMPLETE";
    if(current.processing_status==="PROCESSING"&&current.lease_expires_at&&current.lease_expires_at>new Date())return "BUSY";
    const claimed=await db.query("UPDATE stripe_events SET processing_status='PROCESSING',attempts=attempts+1,lease_expires_at=now()+($2||' seconds')::interval,processing_note=NULL,payload=$3::jsonb,updated_at=now() WHERE event_id=$1 RETURNING event_id",[input.eventId,String(lease),JSON.stringify(input.payload)]);
    return claimed.rowCount?"CLAIMED":"BUSY";
  });
}
export async function failStripeEvent(eventId:string,error:unknown):Promise<void>{
  await transaction(db=>db.query("UPDATE stripe_events SET processing_status='FAILED',processing_note=$2,lease_expires_at=NULL,updated_at=now() WHERE event_id=$1 AND processing_status='PROCESSING'",[eventId,error instanceof Error?error.message:"processing failure"]));
}
