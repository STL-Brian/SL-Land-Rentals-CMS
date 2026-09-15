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
    const result = await loginWithPassword(input.username, input.password, clientIp(req.headers, cfg.trustProxy));
    if (!result) return NextResponse.json({ message: "Unable to sign in with those credentials." }, { status: 401, headers: noStoreHeaders });
    const response = NextResponse.json({ redirect: result.redirect }, { headers: noStoreHeaders });
    response.cookies.set("lte_session", result.token, sessionCookieOptions(cfg.cookieSecure));
    return response;
  } catch {
    return NextResponse.json({ message: "Unable to sign in with those credentials." }, { status: 400, headers: noStoreHeaders });
  }
}
