"use client";
import { formatDate } from "../lib/date-time";

import { useMemo, useState } from "react";
import { RentalControls } from "./rental-controls";

export type RentalDisplayRow = {
  id: string;
  name: string;
  displayName: string;
  canonicalUsername: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
};

export function RentalsTable({ rows }: { rows: RentalDisplayRow[] }) {
  const [status, setStatus] = useState("ACTIVE");
  const visible = useMemo(() => status === "ALL" ? rows : rows.filter((row) => row.status === status), [rows, status]);
  const statuses = Array.from(new Set(rows.map((row) => row.status))).sort();
  return <>
    <div className="table-toolbar"><label className="filter-field"><span>Rental status</span><select aria-label="Filter rentals by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ACTIVE">Active only</option><option value="ALL">All statuses</option>{statuses.filter((item) => item !== "ACTIVE").map((item) => <option key={item} value={item}>{item.toLocaleLowerCase().replace("_", " ")}</option>)}</select></label><span>{visible.length} rental{visible.length === 1 ? "" : "s"}</span></div>
    <div className="table-scroll"><table className="table"><thead><tr><th>Rental</th><th>Resident identity</th><th>Status</th><th>Term (Chicago)</th><th>Action</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td><strong>{row.displayName}</strong><small>{row.canonicalUsername ?? "Unlinked"}</small></td><td><span className="status">{row.status}</span></td><td>{formatDate(row.startsAt)} – {formatDate(row.endsAt)}</td><td>{row.status === "ACTIVE" ? <RentalControls id={row.id}/> : "—"}</td></tr>)}</tbody></table>{visible.length === 0 && <p className="empty">No rentals match this status.</p>}</div>
  </>;
}
