import { NextResponse } from "next/server";
import { passwordChangeSchema } from "@lake-tech/contracts";
import { defaultAuthenticatedPath } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { changePassword, currentViewer } from "../../../../lib/auth";
import { assertBrowserOrigin, clientIp, noStoreHeaders, sessionCookieOptions } from "../../../../lib/http";
import { env } from "../../../../lib/env";
import { consumeRateLimit } from "../../../../lib/rate-limit";

export async function POST(req: Request) {
  const headers = noStoreHeaders;
  try {
    const cfg = env();
    assertBrowserOrigin(req.headers, cfg.baseUrl);
    const viewer = await currentViewer();
    if (!viewer) return NextResponse.json({ message: "Authentication required." }, { status: 401, headers });
    const input = passwordChangeSchema.parse(await req.json());
    const ip = clientIp(req.headers, cfg.trustProxy);
    const allowed = await transaction(async db => {
      const ipAllowed = await consumeRateLimit(db, "password-change-ip", ip, 10, 600);
      const userAllowed = await consumeRateLimit(db, "password-change-user", viewer.id, 5, 600);
      return ipAllowed && userAllowed;
    });
    if (!allowed) return NextResponse.json({ message: "Too many password-change attempts. Try again later." }, { status: 429, headers });
    const token = await changePassword(viewer.id, input.currentPassword, input.password);
    if (!token) return NextResponse.json({ message: "Current password is incorrect." }, { status: 401, headers });
    const response = NextResponse.json({ redirect: defaultAuthenticatedPath(viewer.role) }, { headers });
    response.cookies.set("lte_session", token, sessionCookieOptions(cfg.cookieSecure));
    return response;
  } catch {
    return NextResponse.json({ message: "Unable to change the password." }, { status: 400, headers });
  }
}
