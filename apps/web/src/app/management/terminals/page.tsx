import { query } from "@lake-tech/db";
import { requireViewer } from "../../../lib/auth";
import { LocalDateTime } from "../../../components/local-date-time";
import { AppShell } from "../../../components/app-shell";
import { TerminalActions, TerminalHealthAction, TerminalProvisionForm } from "../../../components/admin-ops";
export const dynamic = "force-dynamic";

type TerminalRow = { id:string; listing_id:string; listing_name:string; object_id:string; owner_name:string|null; enabled:boolean; last_seen_at:Date|null; health_status:string; health_checked_at:Date|null };
export default async function Terminals(){
  const viewer=await requireViewer("terminal:manage");
  const [listings,terminals]=await Promise.all([
    query<{id:string;name:string}>("SELECT id,name FROM listings ORDER BY name"),
    query<TerminalRow>(`SELECT t.id,t.listing_id,l.name listing_name,t.object_id,u.display_name owner_name,t.enabled,t.last_seen_at,
      CASE WHEN t.health_status='HEALTHY' AND t.health_checked_at>now()-interval '2 minutes' THEN 'HEALTHY' ELSE 'STALE' END health_status,t.health_checked_at
      FROM terminals t JOIN listings l ON l.id=t.listing_id LEFT JOIN sl_identities si ON si.avatar_id=t.owner_id LEFT JOIN users u ON u.id=si.user_id WHERE t.enabled ORDER BY t.created_at DESC`)
  ]);
  return <AppShell viewer={viewer} eyebrow="Management / Infrastructure" title="Rental terminals">
    <section className="panel card"><h2>Provision terminal</h2><TerminalProvisionForm listings={listings.rows}/></section>
    <section className="panel card"><div className="section-head"><div><h2>Bindings</h2><p>Terminal identity and live connectivity.</p></div></div><div className="table-scroll"><table className="table table-dark table-hover align-middle mb-0"><thead><tr><th>Listing</th><th>Object identity</th><th>Owner</th><th>Status</th><th>Last seen</th><th>Health</th><th>Action</th></tr></thead><tbody>{terminals.rows.map(t=><tr key={t.id}><td>{t.listing_name}</td><td className="mono">{t.object_id}</td><td><strong>{t.owner_name??"Unknown resident"}</strong></td><td>{t.enabled?"Enabled":"Revoked"}</td><td>{t.last_seen_at?<LocalDateTime value={t.last_seen_at}/> : "Never"}</td><td><TerminalHealthAction id={t.id} initialStatus={t.enabled?t.health_status:"UNREACHABLE"}/></td><td><TerminalActions id={t.id} listingId={t.listing_id} listings={listings.rows}/></td></tr>)}</tbody></table></div></section>
  </AppShell>;
}
