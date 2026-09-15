import { describe, expect, it } from "vitest";
import pg from "pg";
const url=process.env.DATABASE_URL;
const run=url?it:it.skip;
describe("PostgreSQL OTP concurrency",()=>{
 run("serializes create and verify on the same canonical identity and invalidates the old challenge",async()=>{
  const a=new pg.Client({connectionString:url});const b=new pg.Client({connectionString:url});await Promise.all([a.connect(),b.connect()]);const canonical=`race-${crypto.randomUUID()} resident`;const avatar=crypto.randomUUID();const oldId=crypto.randomUUID(),newId=crypto.randomUUID();
  try{await a.query(`INSERT INTO login_challenges(id,avatar_id,canonical_username,otp_digest,expires_at,last_sent_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes',now()-interval '2 minutes')`,[oldId,avatar,canonical,"0".repeat(64)]);await a.query("BEGIN");await a.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`login:${canonical}`]);
   let acquired=false;const waiter=(async()=>{await b.query("BEGIN");await b.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`login:${canonical}`]);acquired=true;await b.query("UPDATE login_challenges SET consumed_at=now() WHERE canonical_username=$1 AND consumed_at IS NULL",[canonical]);await b.query(`INSERT INTO login_challenges(id,avatar_id,canonical_username,otp_digest,expires_at,last_sent_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes',now())`,[newId,avatar,canonical,"1".repeat(64)]);await b.query("COMMIT")})();
   await new Promise(r=>setTimeout(r,75));expect(acquired).toBe(false);await a.query("COMMIT");await waiter;const rows=await a.query("SELECT id,consumed_at FROM login_challenges WHERE canonical_username=$1 ORDER BY created_at",[canonical]);expect(rows.rows.find(r=>r.id===oldId)?.consumed_at).not.toBeNull();expect(rows.rows.find(r=>r.id===newId)?.consumed_at).toBeNull();
  }finally{await a.query("ROLLBACK").catch(()=>undefined);await b.query("ROLLBACK").catch(()=>undefined);await a.query("DELETE FROM login_challenges WHERE canonical_username=$1",[canonical]).catch(()=>undefined);await Promise.all([a.end(),b.end()]);}
 },10_000);
});
