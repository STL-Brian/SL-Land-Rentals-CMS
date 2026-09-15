"use client";
import { formatDateTime } from "../lib/date-time";

import { useMemo, useState } from "react";

export type AuditDisplayRow = {
  id: string;
  action: string;
  actor: string;
  targetType: string;
  targetId: string | null;
  details: Array<[string, string]>;
  createdAt: string;
};

const pageSize = 20;

export function AuditTable({ rows }: { rows: AuditDisplayRow[] }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [row.action, row.actor, row.targetType, row.targetId ?? "", ...row.details.flat()].join(" ").toLocaleLowerCase().includes(needle));
  }, [rows, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  function updateSearch(value: string) { setSearch(value); setPage(0); }

  return <>
    <div className="table-toolbar"><label className="search-field"><span className="sr-only">Search security audit</span><input type="search" aria-label="Search security audit" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Search actor, action, target, or details" /></label><span>{filtered.length} event{filtered.length === 1 ? "" : "s"}</span></div>
    <div className="table-scroll"><table className="table"><thead><tr><th>Time (Chicago)</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>{visible.map((entry) => <tr key={entry.id}><td>{formatDateTime(entry.createdAt)}</td><td>{entry.actor}</td><td>{entry.action}</td><td>{entry.targetType} · {entry.targetId ?? "—"}</td><td>{entry.details.length ? <dl>{entry.details.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : "—"}</td></tr>)}</tbody></table>{visible.length === 0 && <p className="empty">No audit events match this search.</p>}</div>
    <nav className="pagination" aria-label="Security audit pages"><button className="button secondary" type="button" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button className="button secondary" type="button" aria-label="Next page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></nav>
  </>;
}
