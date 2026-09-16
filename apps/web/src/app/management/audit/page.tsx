import { query, ready } from "@lake-tech/db";
import { requireViewer } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { AuditTable } from "../../../components/audit-table";
import { LocalDateTime } from "../../../components/local-date-time";
export const dynamic = "force-dynamic";
const sensitiveKey = /secret|ciphertext|password|token|payload|signature|digest/i;
export function safeAuditDetails(details: unknown): Array<[string,string]> { if(!details||typeof details!=="object"||Array.isArray(details))return []; return Object.entries(details as Record<string,unknown>).filter(([key])=>!sensitiveKey.test(key)).map(([key,value])=>[key,value===null||["string","number","boolean"].includes(typeof value)?String(value):"[structured value omitted]"]); }
type AuditRow={id:string;action:string;actor:string|null;target_type:string;target_id:string|null;details:unknown;created_at:Date};
type WorkerRow={worker_id:string;mode:string;adapter_connected:boolean;heartbeat_at:Date;last_error:string|null};
type HealthItem={id:string;label:string;healthy:boolean;fresh:boolean;detail:string;at?:Date};
function healthState(item:HealthItem){return item.healthy&&item.fresh?"healthy":"degraded";}
export default async function Audit(){
 const viewer=await requireViewer("audit:view");
 const [audit,workers,backlog,databaseReady]=await Promise.all([
  query<AuditRow>(`SELECT a.id::text,a.action,u.display_name actor,a.target_type,a.target_id,a.details,a.created_at FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id ORDER BY a.created_at DESC LIMIT 200`),
  query<WorkerRow>(`SELECT worker_id,mode,adapter_connected,heartbeat_at,last_error FROM bot_health WHERE mode NOT IN ('simulation','SIMULATION') ORDER BY worker_id`),
  query<{count:string}>(`SELECT count(*)::text count FROM terminal_callback_deliveries WHERE delivered_at IS NULL AND dead_lettered_at IS NULL`),
  ready().catch(()=>false),
 ]);
 const now=Date.now(); const fresh=(at:Date)=>now-at.getTime()<30_000; const byId=new Map(workers.rows.map(w=>[w.worker_id,w]));
 const items:HealthItem[]=["sl-bot","payment-worker","callback-worker"].map(id=>{const w=byId.get(id);return {id,label:id,healthy:Boolean(w?.adapter_connected),fresh:Boolean(w&&fresh(w.heartbeat_at)),detail:w?.last_error??(w?`${w.mode} worker`:"No heartbeat"),at:w?.heartbeat_at};});
 items.push({id:"web",label:"web readiness",healthy:true,fresh:true,detail:"HTTP process ready"},{id:"database",label:"database readiness",healthy:databaseReady,fresh:true,detail:databaseReady?"Database query succeeded":"Database query failed"});
 const pending=Number(backlog.rows[0]?.count??0); items.push({id:"callback-backlog",label:"callback backlog",healthy:pending===0,fresh:true,detail:`${pending} pending callback deliveries`});
 const auditRows=audit.rows.map(e=>({id:e.id,action:e.action,actor:e.actor??"System",targetType:e.target_type,targetId:e.target_id,details:safeAuditDetails(e.details),createdAt:e.created_at.toISOString()}));
 return <AppShell viewer={viewer} eyebrow="Management / Security" title="Audit & system health"><section className="panel card worker-health"><div className="section-head"><div><h2>Service health</h2><p>Real production workers only. Heartbeats older than 30 seconds are stale.</p></div></div><div className="worker-list">{items.map(item=><article className="worker-row" key={item.id}><div><strong>{item.label}</strong><small>{item.at&&<><LocalDateTime value={item.at}/> · </>}{item.detail}</small></div><span className={`health-state ${healthState(item)}`}>{healthState(item)==="healthy"?"Healthy":"Stale / degraded"}</span></article>)}</div></section><section className="panel card" aria-labelledby="security-audit-heading"><div className="section-head"><div><h2 id="security-audit-heading">Security audit</h2><p>Latest 200 security and operator events.</p></div></div><AuditTable rows={auditRows}/></section></AppShell>;
}
