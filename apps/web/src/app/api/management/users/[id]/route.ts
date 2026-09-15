import { NextResponse } from "next/server";
import { roleMutationSchema } from "@lake-tech/contracts";
import { authorizeApi } from "../../../../../lib/authorization";
import { assertBrowserOrigin } from "../../../../../lib/http";
import { env } from "../../../../../lib/env";
import { changeUserRole } from "../../../../../lib/role-management";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertBrowserOrigin(req.headers, env().baseUrl);
  } catch {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  const auth = await authorizeApi("user:manage");
  if (auth.response) return auth.response;
  const parsed = roleMutationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid role change" }, { status: 400 });
  try {
    await changeUserRole(auth.viewer.id, (await params).id, parsed.data.role, parsed.data.reason);
    return NextResponse.json({ updated: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "FAILED";
    if (code === "LAST_ADMINISTRATOR") {
      return NextResponse.json({ error: "The last active administrator cannot be demoted" }, { status: 409 });
    }
    if (code === "ACTIVE_RENTAL_ROLE_CONFLICT") {
      return NextResponse.json({ error: "An active renter must retain renter self-service access" }, { status: 409 });
    }
    if (code === "FORBIDDEN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Role change failed" }, { status: 404 });
  }
}
