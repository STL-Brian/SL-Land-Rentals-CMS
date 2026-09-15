import { formatMoneyMinor } from "@lake-tech/core";
import { query } from "@lake-tech/db";
import { requireViewer } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { ReconciliationActions } from "../../../components/admin-ops";
import { ProviderRecoveryAction } from "../../../components/provider-recovery-action";

export const dynamic = "force-dynamic";

type PaymentRow = {
  id: string;
  provider: string;
  status: string;
  listing_name: string;
  display_name: string;
  amount_linden: number | null;
  amount_minor: number | null;
  currency: string | null;
  received_at: Date;
};
type TerminalReview = {
  terminal_id: string;
  event_id: string;
  listing_name: string;
  payer_avatar_id: string;
  amount_linden: number;
  created_at: Date;
};
type StripeReview = { event_id: string; event_type: string; processing_status: string; processing_note: string | null; updated_at: Date };
type ProviderReview = { id: string; kind: string; state: string; provider_reference: string; last_error: string | null; updated_at: Date };

export default async function Payments() {
  const viewer = await requireViewer("payment:view");
  const administrator = viewer.role === "ADMINISTRATOR";
  const [payments, terminalReviews, stripeReviews, providerReviews] = await Promise.all([
    query<PaymentRow>(
      `SELECT p.id,p.provider,p.status,l.name listing_name,u.display_name,
              p.amount_linden,p.amount_minor,p.currency,p.received_at
       FROM payments p
       JOIN invoices i ON i.id=p.invoice_id
       JOIN listings l ON l.id=i.listing_id
       JOIN users u ON u.id=i.user_id
       ORDER BY p.received_at DESC LIMIT 200`,
    ),
    query<TerminalReview>(
      `SELECT e.terminal_id,e.event_id,l.name listing_name,e.payer_avatar_id,
              e.amount_linden,e.created_at
       FROM terminal_payment_events e
       JOIN terminals t ON t.id=e.terminal_id
       JOIN listings l ON l.id=t.listing_id
       WHERE e.payment_id IS NULL AND e.status='MANUAL_REVIEW'
       ORDER BY e.created_at DESC LIMIT 200`,
    ),
    administrator
      ? query<StripeReview>(
          `SELECT event_id,event_type,processing_status,processing_note,updated_at
           FROM stripe_events
           WHERE processing_status IN ('FAILED','MANUAL_REVIEW')
           ORDER BY updated_at DESC LIMIT 200`,
        )
      : Promise.resolve({ rows: [], rowCount: 0 }),
    administrator
      ? query<ProviderReview>(
          `SELECT id,kind,state,provider_reference,last_error,updated_at
           FROM provider_actions
           WHERE state IN ('QUEUED','PROCESSING','FAILED','MANUAL_REVIEW')
           ORDER BY updated_at DESC LIMIT 200`,
        )
      : Promise.resolve({ rows: [], rowCount: 0 }),
  ]);

  return (
    <AppShell viewer={viewer} eyebrow="Management / Finance" title="Payments & reconciliation">
      <section className="panel" aria-labelledby="payment-ledger-heading">
        <div className="section-head"><div><h2 id="payment-ledger-heading">Payment ledger</h2><p>Provider state and operator review.</p></div></div>
        <div className="table-scroll"><table className="table"><thead><tr><th>Rental</th><th>Resident</th><th>Provider</th><th>Amount</th><th>Status</th><th>Received</th><th>Action</th></tr></thead><tbody>
          {payments.rows.map((payment) => <tr key={payment.id}>
            <td>{payment.listing_name}</td><td>{payment.display_name}</td><td>{payment.provider}</td>
            <td>{payment.amount_linden !== null ? `L$${payment.amount_linden.toLocaleString()}` : `${formatMoneyMinor(payment.amount_minor!)} ${(payment.currency ?? "").toUpperCase()}`}</td>
            <td><span className="status">{payment.status}</span></td><td>{payment.received_at.toLocaleString()}</td>
            <td>{payment.status !== "MANUAL_REVIEW" ? "—" : payment.provider === "LINDEN" ? <ReconciliationActions id={payment.id} /> : administrator ? <ReconciliationActions id={`stripe-payment:${payment.id}`} kind="STRIPE_PAYMENT" /> : "Administrator required"}</td>
          </tr>)}
        </tbody></table></div>
      </section>

      <section className="panel" aria-labelledby="unlinked-terminal-heading">
        <h2 id="unlinked-terminal-heading">Unlinked terminal payments</h2>
        <p>Payments whose Second Life payer has not been linked to an account.</p>
        <div className="table-scroll"><table className="table"><thead><tr><th>Rental</th><th>Payer avatar</th><th>Amount</th><th>Received</th><th>Action</th></tr></thead><tbody>
          {terminalReviews.rows.map((item) => <tr key={`${item.terminal_id}:${item.event_id}`}><td>{item.listing_name}</td><td>{item.payer_avatar_id}</td><td>L${item.amount_linden.toLocaleString()}</td><td>{item.created_at.toLocaleString()}</td><td>{administrator ? <ReconciliationActions id={`${item.terminal_id}:${item.event_id}`} unlinked /> : "Administrator required"}</td></tr>)}
        </tbody></table></div>
      </section>

      {administrator && <section className="panel" aria-labelledby="stripe-review-heading">
        <h2 id="stripe-review-heading">Stripe event recovery</h2>
        <div className="table-scroll"><table className="table"><thead><tr><th>Event</th><th>Type</th><th>Status</th><th>Note</th><th>Updated</th><th>Action</th></tr></thead><tbody>
          {stripeReviews.rows.map((item) => <tr key={item.event_id}><td>{item.event_id}</td><td>{item.event_type}</td><td>{item.processing_status}</td><td>{item.processing_note ?? "—"}</td><td>{item.updated_at.toLocaleString()}</td><td><ReconciliationActions id={`stripe-event:${item.event_id}`} kind="STRIPE_EVENT" /></td></tr>)}
        </tbody></table></div>
      </section>}

      {administrator && <section className="panel" aria-labelledby="provider-action-heading">
        <h2 id="provider-action-heading">Provider actions</h2>
        <div className="table-scroll"><table className="table"><thead><tr><th>Kind</th><th>Reference</th><th>State</th><th>Error</th><th>Updated</th><th>Action</th></tr></thead><tbody>
          {providerReviews.rows.map((item) => <tr key={item.id}><td>{item.kind}</td><td>{item.provider_reference}</td><td>{item.state}</td><td>{item.last_error ?? "—"}</td><td>{item.updated_at.toLocaleString()}</td><td><ProviderRecoveryAction id={item.id} state={item.state} /></td></tr>)}
        </tbody></table></div>
      </section>}
    </AppShell>
  );
}
