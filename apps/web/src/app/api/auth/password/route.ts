import { NextResponse } from "next/server";
import { passwordLoginSchema } from "@lake-tech/contracts";
import { loginWithPassword } from "../../../../lib/auth";
import { assertBrowserOrigin, clientIp, noStoreHeaders, sessionCookieOptions } from "../../../../lib/http";
import { env } from "../../../../lib/env";

export async function POST(req: Request) {
  try {
    const cfg = env();
    assertBrowserOrigin(req.headers, cfg.baseUrl);
    const input = passwordLoginSchema.parse(await req.json());
    const token = await loginWithPassword(input.username, input.password, clientIp(req.headers, cfg.trustProxy));
    if (!token) return NextResponse.json({ message: "Unable to sign in with those credentials." }, { status: 401, headers: noStoreHeaders });
    const response = NextResponse.json({ redirect: "/dashboard" }, { headers: noStoreHeaders });
    response.cookies.set("lte_session", token, sessionCookieOptions(cfg.cookieSecure));
    return response;
  } catch {
    return NextResponse.json({ message: "Unable to sign in with those credentials." }, { status: 400, headers: noStoreHeaders });
  }
}
