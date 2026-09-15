import { NextResponse } from "next/server";
import { can } from "@lake-tech/core";
import { query } from "@lake-tech/db";
import { currentViewer } from "../../../../lib/auth";
import { noStoreHeaders } from "../../../../lib/http";

export async function GET(): Promise<NextResponse> {
  const viewer = await currentViewer();
  if (!viewer) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!can(viewer.role, "payment:view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const reviews = await query(`
    SELECT COALESCE(p.id::text,t.terminal_id::text||':'||t.event_id) id,'PAYMENT' kind,'LINDEN' provider,
           t.amount_linden,NULL::int amount_minor,t.expected_amount_linden,NULL::int expected_amount_minor,
           l.name listing_name,t.payer_avatar_id::text payer
    FROM terminal_payment_events t
    JOIN terminals x ON x.id=t.terminal_id JOIN listings l ON l.id=x.listing_id
    LEFT JOIN payments p ON p.id=t.payment_id WHERE t.status='MANUAL_REVIEW'
    UNION ALL
    SELECT p.id::text,'PAYMENT',p.provider,p.amount_linden,p.amount_minor,p.expected_amount_linden,
           p.expected_amount_minor,l.name,NULL
    FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN listings l ON l.id=i.listing_id
    WHERE p.status='MANUAL_REVIEW' AND p.provider<>'LINDEN'
    ORDER BY listing_name`);

  if (viewer.role !== "ADMINISTRATOR") {
    return NextResponse.json({ reviews: reviews.rows, stripeEvents: [], providerActions: [] }, { headers: noStoreHeaders });
  }

  const [events, actions] = await Promise.all([
    query(`SELECT 'stripe-event:'||event_id id,'STRIPE_EVENT' kind,event_type,processing_status state,
                  attempts,processing_note,last_error
           FROM (SELECT *,NULL::text last_error FROM stripe_events) e
           WHERE processing_status IN ('FAILED','MANUAL_REVIEW','PROCESSING') ORDER BY updated_at`),
    query(`SELECT 'provider-action:'||a.id id,'PROVIDER_ACTION' kind,a.kind action_kind,a.state,a.attempts,
                  a.provider_action_id,a.provider_status,a.last_error,l.name listing_name
           FROM provider_actions a JOIN invoices i ON i.id=a.invoice_id JOIN listings l ON l.id=i.listing_id
           WHERE a.state<>'RESOLVED' ORDER BY a.created_at`),
  ]);
  return NextResponse.json({ reviews: reviews.rows, stripeEvents: events.rows, providerActions: actions.rows }, { headers: noStoreHeaders });
}
