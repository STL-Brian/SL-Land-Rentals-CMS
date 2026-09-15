import { NextResponse } from "next/server";
import { passwordSetupSchema } from "@lake-tech/contracts";
import { completePasswordSetup } from "../../../../lib/auth";
import { assertBrowserOrigin, clientIp, noStoreHeaders, sessionCookieOptions } from "../../../../lib/http";
import { env } from "../../../../lib/env";

export async function POST(req: Request) {
  try {
    const cfg = env();
    assertBrowserOrigin(req.headers, cfg.baseUrl);
    const input = passwordSetupSchema.parse(await req.json());
    const token = await completePasswordSetup(input.grant, input.password, clientIp(req.headers, cfg.trustProxy));
    if (!token) return NextResponse.json({ message: "This password setup link is invalid or expired." }, { status: 401, headers: noStoreHeaders });
    const response = NextResponse.json({ redirect: "/dashboard" }, { headers: noStoreHeaders });
    response.cookies.set("lte_session", token, sessionCookieOptions(cfg.cookieSecure));
    return response;
  } catch {
    return NextResponse.json({ message: "Unable to set the password." }, { status: 400, headers: noStoreHeaders });
  }
}
