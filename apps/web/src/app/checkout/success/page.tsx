import Link from "next/link";
import { query } from "@lake-tech/db";
import { currentViewer } from "../../../lib/auth";
export const dynamic = "force-dynamic";
export default async function Success({searchParams}:{searchParams:Promise<{invoice?:string}>}) {
  const viewer=await currentViewer();
  const invoice=(await searchParams).invoice;
  const result=viewer&&invoice?await query<{status:string}>(`SELECT p.status FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.id=$1 AND i.user_id=$2 ORDER BY p.received_at DESC LIMIT 1`,[invoice,viewer.id]):{rows:[]};
  const status=result.rows[0]?.status??"PROCESSING";
  return <section className="panel form-shell"><div className="eyebrow">Checkout returned</div><h1 className="section-title">Payment {status.toLowerCase()}</h1><p>Returning from checkout does not activate a lease. Only the verified payment handler can do that.</p><Link className="button" href={viewer?"/portal":"/login"}>{viewer?"Open resident portal":"Sign in to view payment"}</Link></section>;
}
