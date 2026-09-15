import { query } from "@lake-tech/db";
import { requireViewer } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { AuditTable } from "../../../components/audit-table";
import { LocalDateTime } from "../../../components/local-date-time";

export const dynamic = "force-dynamic";

const sensitiveKey = /secret|ciphertext|password|token|payload|signature|digest/i;

export function safeAuditDetails(details: unknown): Array<[string, string]> {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return Object.entries(details as Record<string, unknown>)
    .filter(([key]) => !sensitiveKey.test(key))
    .map(([key, value]) => {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) return [key, String(value)];
      return [key, "[structured value omitted]"];
    });
}

type AuditRow = {
  id: string;
  action: string;
  actor: string | null;
  target_type: string;
  target_id: string | null;
  details: unknown;
  created_at: Date;
};
type WorkerRow = { worker_id: string; mode: string; adapter_connected: boolean; heartbeat_at: Date; last_error: string | null };

export default async function Audit() {
  const viewer = await requireViewer("audit:view");
  const [audit, workers] = await Promise.all([
    query<AuditRow>(
      `SELECT a.id::text,a.action,u.display_name actor,a.target_type,a.target_id,a.details,a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
       ORDER BY a.created_at DESC LIMIT 200`,
    ),
    query<WorkerRow>("SELECT worker_id,mode,adapter_connected,heartbeat_at,last_error FROM bot_health ORDER BY worker_id"),
  ]);
  const auditRows = audit.rows.map((entry) => ({ id: entry.id, action: entry.action, actor: entry.actor ?? "System", targetType: entry.target_type, targetId: entry.target_id, details: safeAuditDetails(entry.details), createdAt: entry.created_at.toISOString() }));
  return <AppShell viewer={viewer} eyebrow="Management / Security" title="Audit & system health">
    <section className="panel worker-health"><div className="section-head"><div><h2>Worker health</h2><p>Current background service status.</p></div></div><div className="worker-list">{workers.rows.map((worker) => <article className="worker-row" key={worker.worker_id}><div><strong>{worker.worker_id}</strong><small><LocalDateTime value={worker.heartbeat_at}/> · {worker.mode}</small></div><span className={worker.adapter_connected ? "health-state healthy" : "health-state degraded"}>{worker.adapter_connected ? "Healthy" : "Degraded"}</span>{worker.last_error && <p>{worker.last_error}</p>}</article>)}</div></section>
    <section className="panel" aria-labelledby="security-audit-heading"><div className="section-head"><div><h2 id="security-audit-heading">Security audit</h2><p>Latest 200 security and operator events.</p></div></div><AuditTable rows={auditRows}/></section>
  </AppShell>;
}
