import { NextResponse } from "next/server";
import { challengeRequestSchema } from "@lake-tech/contracts";
import { requestChallenge } from "../../../../lib/auth";
import { assertBrowserOrigin, clientIp, noStoreHeaders } from "../../../../lib/http";
import { env } from "../../../../lib/env";
import { query } from "@lake-tech/db";

export async function POST(req: Request) {
  try {
    const cfg = env();
    assertBrowserOrigin(req.headers, cfg.baseUrl);
    const { username } = challengeRequestSchema.parse(await req.json());
    const ip = clientIp(req.headers, cfg.trustProxy);
    const found = await query<{ password_hash: string | null; active: boolean }>(
      "SELECT u.password_hash,u.active FROM users u JOIN sl_identities sli ON sli.user_id=u.id WHERE sli.canonical_username=$1 LIMIT 1", [username]);
    if (!found.rows[0] || !found.rows[0].password_hash) await requestChallenge(username, ip);
    // The response intentionally does not disclose account or credential state.
    return NextResponse.json({ mode: "password" }, { headers: noStoreHeaders });
  } catch {
    return NextResponse.json({ message: "Unable to continue." }, { status: 400, headers: noStoreHeaders });
  }
}
