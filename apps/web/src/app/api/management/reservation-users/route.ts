import { NextResponse } from "next/server";
import { query } from "@lake-tech/db";
import { authorizeApi } from "../../../../lib/authorization";
import { noStoreHeaders } from "../../../../lib/http";
import { reservationUserSearchPattern } from "../../../../lib/reservation-user-search";

export async function GET(req: Request) {
  const auth = await authorizeApi("reservation:manage");
  if (auth.response) return auth.response;
  const term = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (term.length<3 || term.length>63) return NextResponse.json([], { headers: noStoreHeaders });
  const users = await query<{ id: string; display_name: string; canonical_username: string | null }>(
    `SELECT u.id,u.display_name,s.canonical_username
     FROM users u JOIN sl_identities s ON s.user_id=u.id
     WHERE u.active AND u.role IN ('RESIDENT','RENTER','ADMINISTRATOR')
       AND ($2::boolean OR u.role IN ('RESIDENT','RENTER'))
       AND (u.display_name ILIKE $1 ESCAPE '\\' OR s.canonical_username ILIKE $1 ESCAPE '\\')
     ORDER BY u.display_name LIMIT 10`,
    [reservationUserSearchPattern(term), auth.viewer.role !== "AGENT"],
  );
  return NextResponse.json(users.rows, { headers: noStoreHeaders });
}
