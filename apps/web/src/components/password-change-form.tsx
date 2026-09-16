"use client";

import { FormEvent, useState } from "react";

export function PasswordChangeForm() {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: String(form.get("currentPassword") ?? ""),
          password: String(form.get("password") ?? ""),
          confirmation: String(form.get("confirmation") ?? ""),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.message ?? "Unable to change the password.");
        return;
      }
      window.location.assign(body.redirect ?? "/");
    } catch {
      setMessage("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="modern-form" onSubmit={submit}>
    <div className="form-field"><label htmlFor="currentPassword">Current password</label><input className="form-control" id="currentPassword" name="currentPassword" type="password" minLength={12} maxLength={1024} autoComplete="current-password" required /></div>
    <div className="form-field"><label htmlFor="password">New password</label><input className="form-control" id="password" name="password" type="password" minLength={12} maxLength={1024} autoComplete="new-password" required /><small>Use at least 12 characters.</small></div>
    <div className="form-field"><label htmlFor="confirmation">Confirm new password</label><input className="form-control" id="confirmation" name="confirmation" type="password" minLength={12} maxLength={1024} autoComplete="new-password" required /></div>
    {message && <p className="form-message" role="alert">{message}</p>}
    <div className="form-actions"><button className="button btn btn-primary" type="submit" disabled={saving}>{saving ? "Changing…" : "Change password"}</button></div>
  </form>;
}
