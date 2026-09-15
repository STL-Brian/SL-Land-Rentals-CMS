import type { Permission } from "@lake-tech/core";
import { can } from "@lake-tech/core";
import { NextResponse } from "next/server";
import { currentViewer, type Viewer } from "./auth";

export type ApiAuthorization = { viewer: Viewer; response?: never } | { viewer?: never; response: NextResponse };

export async function authorizeApi(permission: Permission): Promise<ApiAuthorization> {
  const viewer = await currentViewer();
  if (!viewer) return { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (!can(viewer.role, permission)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { viewer };
}
