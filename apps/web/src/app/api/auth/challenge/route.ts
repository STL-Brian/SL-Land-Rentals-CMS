import { NextResponse } from "next/server";
import { challengeRequestSchema } from "@lake-tech/contracts";
import { requestChallenge } from "../../../../lib/auth";
import { assertBrowserOrigin, clientIp, noStoreHeaders } from "../../../../lib/http";
import { env } from "../../../../lib/env";

const GENERIC_MESSAGE = "If that Second Life account can receive messages, a code is on its way.";

export async function POST(req: Request) {
  try {
    const cfg = env();
    assertBrowserOrigin(req.headers, cfg.baseUrl);
    const { username } = challengeRequestSchema.parse(await req.json());
    await requestChallenge(username, clientIp(req.headers, cfg.trustProxy));
    return NextResponse.json({ message: GENERIC_MESSAGE }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: noStoreHeaders });
    }
    console.error("challenge request rejected", error);
    return NextResponse.json({ message: GENERIC_MESSAGE }, { headers: noStoreHeaders });
  }
}
