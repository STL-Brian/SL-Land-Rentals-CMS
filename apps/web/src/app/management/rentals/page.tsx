import { query } from "@lake-tech/db";
import { requireViewer } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { RentalsTable } from "../../../components/rentals-table";

export const dynamic = "force-dynamic";

type RentalRow = { id: string; name: string; display_name: string; canonical_username: string | null; status: string; starts_at: Date; ends_at: Date };

export default async function Rentals() {
  const viewer = await requireViewer("rental:manage");
  const rows = await query<RentalRow>(`SELECT r.id,l.name,u.display_name,s.canonical_username,r.status,r.starts_at,r.ends_at
    FROM rentals r JOIN listings l ON l.id=r.listing_id JOIN users u ON u.id=r.user_id
    LEFT JOIN sl_identities s ON s.user_id=u.id ORDER BY r.created_at DESC`);
  const displayRows = rows.rows.map((row) => ({ id: row.id, name: row.name, displayName: row.display_name, canonicalUsername: row.canonical_username, status: row.status, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString() }));
  return <AppShell viewer={viewer} eyebrow="Management / Leasing" title="Rentals"><section className="panel card"><div className="section-head"><div><h2>Lease history</h2><p>Active rentals are shown by default. Change the filter to review past terms.</p></div></div><RentalsTable rows={displayRows}/></section></AppShell>;
}
