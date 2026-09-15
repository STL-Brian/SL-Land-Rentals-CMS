"use client";

import { type FormEvent, useState } from "react";
import type { UserRole } from "@lake-tech/core";
import { Field, FormActions, Modal } from "./form-primitives";

const roles: UserRole[] = ["ADMINISTRATOR", "MANAGER", "AGENT", "RENTER", "RESIDENT"];

export function UserRoleForm({ id, current }: { id: string; current: UserRole }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(current);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/management/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, reason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "Role change failed.");
        return;
      }
      location.reload();
    } catch {
      setMessage("Unable to reach the service. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (saving) return;
    setRole(current);
    setReason("");
    setMessage("");
    setOpen(false);
  }

  return <>
    <div className="role-cell"><span className="role-value">{current.replace("_", " ")}</span><button className="button secondary" type="button" onClick={() => setOpen(true)}>Edit role</button></div>
    <Modal open={open} onClose={close} title="Edit user role" description="Changing a role immediately revokes every active session for this account." closeOnBackdrop={!saving}>
      <form className="modern-form" onSubmit={save}>
        <Field label="Role"><select autoFocus value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Reason for change" help="Required for the security audit trail."><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} required /></Field>
        {message && <p className="form-message" role="alert">{message}</p>}
        <FormActions><button className="button secondary" type="button" onClick={close}>Cancel</button><button className="button" type="submit" disabled={saving || role === current}>{saving ? "Saving…" : "Save role"}</button></FormActions>
      </form>
    </Modal>
  </>;
}
