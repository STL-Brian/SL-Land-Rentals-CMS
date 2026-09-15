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
    const result = await verifyChallenge(username, code, clientIp(req.headers, cfg.trustProxy));
    if (!result) {
      return NextResponse.json({ message: "That code is invalid or expired." }, { status: 401, headers: noStoreHeaders });
    }
    if (typeof result === "string" && result.startsWith("SETUP:")) {
      return NextResponse.json({ setup: true, grant: result.slice(6) }, { headers: noStoreHeaders });
    }
    if (typeof result === "string") return NextResponse.json({ message: "That code is invalid or expired." }, { status: 401, headers: noStoreHeaders });
    const response = NextResponse.json({ redirect: result.redirect }, { headers: noStoreHeaders });
    response.cookies.set("lte_session", result.token, sessionCookieOptions(cfg.cookieSecure));
    return response;
  } catch {
    return NextResponse.json({ message: "That code is invalid or expired." }, { status: 401, headers: noStoreHeaders });
  }
}
