import { NextResponse } from "next/server";
import { reservationCreateSchema } from "@lake-tech/contracts";
import { query } from "@lake-tech/db";
import { authorizeApi } from "../../../../lib/authorization";
import { assertBrowserOrigin } from "../../../../lib/http";
import { env } from "../../../../lib/env";
import { createReservation } from "../../../../lib/reservations";

export async function GET() {
  const auth = await authorizeApi("reservation:manage");
  if (auth.response) return auth.response;
  const rows = await query(
    `SELECT x.id,x.status,x.expires_at,x.notes,l.name listing_name,
            u.display_name target_name,c.display_name creator_name
     FROM reservations x
     JOIN listings l ON l.id=x.listing_id
     JOIN users u ON u.id=x.target_user_id
     JOIN users c ON c.id=x.created_by_user_id
     WHERE x.status='ACTIVE' AND x.expires_at>now()
       AND ($1::boolean OR x.created_by_user_id=$2)
     ORDER BY x.expires_at`,
    [auth.viewer.role !== "AGENT", auth.viewer.id],
  );
  return NextResponse.json(rows.rows);
}

export async function POST(req: Request) {
  try {
    assertBrowserOrigin(req.headers, env().baseUrl);
  } catch {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const auth = await authorizeApi("reservation:manage");
  if (auth.response) return auth.response;
  const parsed = reservationCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid reservation" }, { status: 400 });
  try {
    const result = await createReservation(auth.viewer.id, { ...parsed.data, expiresAt: new Date(parsed.data.expiresAt) });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    const conflicts: Record<string, string> = {
      UNAVAILABLE: "Rental is unavailable",
      IDEMPOTENCY_CONFLICT: "Idempotency key was already used for a different reservation",
    };
    const badRequests: Record<string, string> = {
      NOT_FOUND: "Account or rental not found",
      TARGET_ROLE_FORBIDDEN: "Agents may reserve only for active residents or renters",
      INVALID_EXPIRATION: "Reservation expiration is invalid",
    };
    if (conflicts[code]) return NextResponse.json({ error: conflicts[code] }, { status: 409 });
    if (code === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: badRequests[code] ?? "Reservation could not be created" }, { status: 400 });
  }
}
