import { query } from "@lake-tech/db";
import { requireViewer } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { CancelReservation,ReservationForm } from "../../../components/reservation-actions";
export const dynamic="force-dynamic";

export default async function Reservations(){
  const viewer=await requireViewer("reservation:manage");
  await query("UPDATE reservations SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at<=now()");
  const [listings,reservations]=await Promise.all([
    query<{id:string;name:string}>(`SELECT l.id,l.name FROM listings l JOIN pricing p ON p.listing_id=l.id AND p.active
      WHERE l.published
      AND NOT EXISTS(SELECT 1 FROM rentals r WHERE r.listing_id=l.id AND r.status IN ('PENDING','ACTIVE') AND r.ends_at>now())
      AND NOT EXISTS(SELECT 1 FROM reservations x WHERE x.listing_id=l.id AND x.status='ACTIVE' AND x.expires_at>now()) ORDER BY l.name`),
    query<{id:string;listing_name:string;target_name:string;creator_name:string;expires_at:Date;notes:string;created_by_user_id:string}>(`SELECT x.id,l.name listing_name,u.display_name target_name,c.display_name creator_name,x.expires_at,x.notes,x.created_by_user_id
      FROM reservations x JOIN listings l ON l.id=x.listing_id JOIN users u ON u.id=x.target_user_id JOIN users c ON c.id=x.created_by_user_id
      WHERE x.status='ACTIVE' AND x.expires_at>now() AND ($1::boolean OR x.created_by_user_id=$2) ORDER BY x.expires_at`,[viewer.role!=="AGENT",viewer.id]),
  ]);
  return <AppShell viewer={viewer} eyebrow="Management / Concierge" title="Reservations">
    <section className="panel"><h2>Create a time-bounded reservation</h2><p>Prices remain server-owned. Reservations create no invoice, payment, or lease.</p>{listings.rowCount?<ReservationForm listings={listings.rows}/>:<p className="empty">An available listing is required.</p>}</section>
    <section className="panel"><div className="section-head"><h2>Live reservations</h2></div>{reservations.rowCount===0?<p className="empty">No active reservations in your scope.</p>:<div className="table-scroll"><table className="table"><thead><tr><th>Rental</th><th>Customer</th><th>Created by</th><th>Expires</th><th>Notes</th><th>Action</th></tr></thead><tbody>{reservations.rows.map(row=><tr key={row.id}><td>{row.listing_name}</td><td>{row.target_name}</td><td>{row.creator_name}</td><td>{row.expires_at.toLocaleString()}</td><td>{row.notes||"—"}</td><td><CancelReservation id={row.id}/></td></tr>)}</tbody></table></div>}</section>
  </AppShell>;
}
