"use client";
import { type FormEvent, useState } from "react";
import { Field, FormActions } from "../../components/form-primitives";

type Stage = "username" | "password" | "otp" | "setup";

export default function LoginPage() {
  const [stage, setStage] = useState<Stage>("username");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [grant, setGrant] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setMessage(""); setBusy(true);
    try {
      let endpoint = "/api/auth/start"; let body: Record<string, string> = { username };
      if (stage === "password") { endpoint = "/api/auth/password"; body = { username, password }; }
      if (stage === "otp") { endpoint = "/api/auth/verify"; body = { username, code }; }
      if (stage === "setup") { endpoint = "/api/auth/set-password"; body = { grant, password, confirmation }; }
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { setMessage(data.message ?? data.error ?? "Unable to continue"); return; }
      if (stage === "username") {
        if (data.mode === "password") setStage("password");
        else { setStage("otp"); setMessage("A one-time code was delivered in-world."); }
      } else if (stage === "otp" && data.setup) { setGrant(data.grant); setStage("setup"); setMessage("Your account is verified. Set a password to finish creating your account."); }
      else if (data.redirect) location.href = data.redirect;
    } catch { setMessage("Unable to reach the service. Please try again."); }
    finally { setBusy(false); }
  }

  async function useOtp() {
    setBusy(true); setMessage("");
    try { const r = await fetch("/api/auth/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) }); const d = await r.json(); if (!r.ok) { setMessage(d.message ?? "Unable to send a code"); return; } setStage("otp"); setMessage(d.message ?? "A one-time code was delivered in-world."); }
    catch { setMessage("Unable to reach the service. Please try again."); } finally { setBusy(false); }
  }

  const title = stage === "username" ? "Sign in" : stage === "password" ? "Enter your password" : stage === "otp" ? "Verify your account" : "Set your password";
  return <section className="auth-page" aria-labelledby="login-title"><section className="auth-card">
    <p className="eyebrow">Resident portal</p><h1 id="login-title">{title}</h1>
    <p>{stage === "username" ? "Start with your Second Life username." : stage === "password" ? "Use your password, or choose one-time code access instead." : stage === "setup" ? "Choose a password for future sign-ins without Second Life." : "The one-time code is delivered to your linked avatar and expires after ten minutes."}</p>
    <form className="modern-form" onSubmit={submit}>
      {stage !== "setup" && <Field label="Second Life username"><input className="form-control" autoFocus={stage === "username"} autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="firstname.lastname" required disabled={stage !== "username"} /></Field>}
      {stage === "password" && <Field label="Password"><input className="form-control" autoFocus type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></Field>}
      {stage === "otp" && <Field label="One-time code"><input className="form-control" autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} value={code} onChange={e => setCode(e.target.value)} placeholder="8 digits" required /></Field>}
      {stage === "setup" && <><Field label="Password" help="Use at least 12 characters."><input className="form-control" autoFocus type="password" autoComplete="new-password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required /></Field><Field label="Confirm password"><input className="form-control" type="password" autoComplete="new-password" minLength={12} value={confirmation} onChange={e => setConfirmation(e.target.value)} required /></Field></>}
      <FormActions><button className="button btn btn-primary" disabled={busy}>{busy ? "Working…" : stage === "username" ? "Continue" : stage === "password" ? "Sign in" : stage === "otp" ? "Verify account" : "Set password and sign in"}</button>
        {stage === "password" && <button type="button" className="button btn btn-outline-light secondary" onClick={useOtp} disabled={busy}>Use one-time code</button>}
        {stage !== "username" && <button type="button" className="button btn btn-outline-light secondary" onClick={() => { setStage("username"); setPassword(""); setConfirmation(""); setCode(""); setMessage(""); }} disabled={busy}>Use another account</button>}
      </FormActions>
    </form>{message && <p className="form-message" role="status">{message}</p>}
  </section></section>;
}
