import { NextResponse } from "next/server";
import { challengeVerifySchema } from "@lake-tech/contracts";
import { verifyChallenge } from "../../../../lib/auth";
import { assertBrowserOrigin, clientIp, noStoreHeaders, sessionCookieOptions } from "../../../../lib/http";
import { env } from "../../../../lib/env";

export async function POST(req: Request) {
  try {
    const cfg = env();
    assertBrowserOrigin(req.headers, cfg.baseUrl);
    const { username, code } = challengeVerifySchema.parse(await req.json());
    const token = await verifyChallenge(username, code, clientIp(req.headers, cfg.trustProxy));
    if (!token) {
      return NextResponse.json({ message: "That code is invalid or expired." }, { status: 401, headers: noStoreHeaders });
    }
    if (token.startsWith("SETUP:")) return NextResponse.json({ setup: true, grant: token.slice(6) }, { headers: noStoreHeaders });
    const response = NextResponse.json({ redirect: "/admin" }, { headers: noStoreHeaders });
    response.cookies.set("lte_session", token, sessionCookieOptions(cfg.cookieSecure));
    return response;
  } catch {
    return NextResponse.json({ message: "That code is invalid or expired." }, { status: 401, headers: noStoreHeaders });
  }
}
