import Stripe from "stripe";
import {validatePaymentWorkerConfig} from "@lake-tech/core";
import {closePool,transaction} from "@lake-tech/db";
import {runOneProviderAction,type RefundProvider} from "./provider-actions.js";

const cfg=validatePaymentWorkerConfig(process.env);
const stripe=cfg.simulation?null:new Stripe(cfg.stripeSecret!);
const provider:RefundProvider=cfg.simulation
 ? async input=>({id:`simulated-${input.idempotencyKey}`,status:"succeeded"})
 : async input=>{const refund=await stripe!.refunds.create({payment_intent:input.paymentIntent,amount:input.amountMinor,reason:"requested_by_customer"},{idempotencyKey:input.idempotencyKey});return{id:refund.id,status:refund.status??"pending"};};
let stopping=false;
async function heartbeat(healthy:boolean,error:string|null=null){await transaction(db=>db.query(`INSERT INTO bot_health(worker_id,mode,adapter_connected,last_db_ok_at,heartbeat_at,last_error) VALUES('payment-worker',$1,$2,now(),now(),$3) ON CONFLICT(worker_id) DO UPDATE SET mode=EXCLUDED.mode,adapter_connected=EXCLUDED.adapter_connected,last_db_ok_at=now(),heartbeat_at=now(),last_error=EXCLUDED.last_error`,[cfg.simulation?"simulation":"stripe",healthy,error]));}
async function loop(){while(!stopping){try{const worked=await runOneProviderAction(transaction,provider);await heartbeat(true);if(!worked)await new Promise(r=>setTimeout(r,1000));}catch(error){await heartbeat(false,error instanceof Error?error.message:"worker error").catch(()=>undefined);await new Promise(r=>setTimeout(r,1000));}}}
async function shutdown(){stopping=true;await closePool();}
process.on("SIGTERM",()=>void shutdown());process.on("SIGINT",()=>void shutdown());
console.log(`payment action worker ready (${cfg.simulation?"simulation":"stripe"})`);
await loop();
