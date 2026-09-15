import { requireViewer } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { PasswordChangeForm } from "../../../components/password-change-form";

export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const viewer = await requireViewer();
  return <AppShell viewer={viewer} eyebrow="Account / Security" title="Change password">
    <section className="panel" style={{ maxWidth: 640 }}>
      <div className="section-head"><div><h2>Update your password</h2><p>Changing your password signs out every other session on this account.</p></div></div>
      <PasswordChangeForm />
    </section>
  </AppShell>;
}
