"use client";

import { type FormEvent, useRef, useState } from "react";
import { Field, FormActions, Modal } from "./form-primitives";

type Listing = { id: string; name: string };
type User = { id: string; display_name: string; canonical_username: string | null };

export function ReservationForm({ listings }: { listings: Listing[] }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [term, setTerm] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [targetUserId, setTargetUserId] = useState("");
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);
  const listboxId = "reservation-user-options";

  async function search(value: string) {
    setTerm(value);
    setTargetUserId("");
    const trimmed = value.trim();
    const sequence = ++searchSequence.current;
    if (trimmed.length < 3) { setUsers([]); setSearching(false); return; }
    setSearching(true);
    try {
      const response = await fetch(`/api/management/reservation-users?q=${encodeURIComponent(trimmed)}`);
      const results = response.ok ? await response.json() as User[] : [];
      if (sequence === searchSequence.current) setUsers(results);
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }

  function selectUser(user: User) {
    searchSequence.current += 1;
    setTargetUserId(user.id);
    setTerm(`${user.display_name} · ${user.canonical_username ?? "verified account"}`);
    setUsers([]);
    setSearching(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetUserId) { setMessage("Search for and select an existing account."); return; }
    const formData = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/management/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId: formData.get("listingId"), targetUserId, expiresAt: new Date(String(formData.get("expiresAt"))).toISOString(), notes: formData.get("notes"), idempotencyKey: crypto.randomUUID() }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setMessage(body.error ?? "Reservation failed."); return; }
      location.reload();
    } catch {
      setMessage("Unable to reach the service. Your form has been preserved.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="action-form modern-form" onSubmit={submit}>
    <Field label="Available rental"><select className="form-select" name="listingId" required>{listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.name}</option>)}</select></Field>
    <div className="typeahead-field">
      <Field label="Find a verified rental account" help={searching ? "Searching…" : "Type at least three characters, then choose an active Resident, Renter, or Administrator account."}><input className="form-control" role="combobox" aria-label="Find a verified rental account" aria-autocomplete="list" aria-expanded={users.length > 0} aria-controls={listboxId} type="search" value={term} onChange={(event) => void search(event.target.value)} maxLength={63} placeholder="Search verified accounts" autoComplete="off" required /></Field>
      {users.length > 0 && <div className="typeahead-list" id={listboxId} role="listbox" aria-label="Matching accounts">{users.map((user) => <button key={user.id} type="button" role="option" aria-selected={targetUserId === user.id} onClick={() => selectUser(user)}><strong>{user.display_name}</strong><small>{user.canonical_username ?? "Verified account"}</small></button>)}</div>}
      {!searching && term.trim().length >= 3 && users.length === 0 && !targetUserId && <small className="typeahead-empty">No matching verified rental account.</small>}
    </div>
    <Field label="Expires at"><input className="form-control" name="expiresAt" type="datetime-local" required /></Field>
    <Field label="Staff notes"><textarea className="form-control" name="notes" maxLength={1000} /></Field>
    <FormActions><button className="button btn btn-primary" type="submit" disabled={saving}>{saving ? "Creating…" : "Create reservation"}</button></FormActions>
    {message && <p className="form-message" role="alert">{message}</p>}
  </form>;
}

export function CancelReservation({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function cancel() {
    if (!reason.trim()) { setMessage("A cancellation reason is required."); return; }
    setSaving(true);
    const response = await fetch(`/api/management/reservations/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) location.reload(); else { setMessage(body.error ?? "Cancellation failed."); setSaving(false); }
  }
  return <><button className="button btn btn-danger danger" type="button" onClick={() => setOpen(true)}>Cancel</button><Modal open={open} onClose={() => setOpen(false)} title="Cancel reservation" description="This releases the rental for other customers." closeOnBackdrop={!saving}><div className="modern-form"><Field label="Cancellation reason"><textarea className="form-control" autoFocus value={reason} onChange={(event) => setReason(event.target.value)} required /></Field>{message && <p role="alert" className="form-message">{message}</p>}<FormActions><button className="button btn btn-outline-light secondary" type="button" onClick={() => setOpen(false)}>Keep reservation</button><button className="button btn btn-danger danger" type="button" disabled={saving} onClick={() => void cancel()}>{saving ? "Cancelling…" : "Confirm cancellation"}</button></FormActions></div></Modal></>;
}
