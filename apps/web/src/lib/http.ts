import { isIP } from "node:net";

export function assertBrowserOrigin(headers: Headers, baseUrl: string): void {
  const origin = headers.get("origin");
  if (!origin || origin !== new URL(baseUrl).origin) throw new Error("Invalid request origin");
}

export function clientIp(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return "direct";
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return "direct";
  const addresses = forwarded.split(",").map((value) => value.trim());
  // Exactly one nginx boundary is trusted. Longer/empty/malformed chains are
  // ambiguous (including coalesced repeated header fields), so fail closed.
  if (addresses.length > 2 || addresses.some((value) => !value || !isIP(value))) return "direct";
  return addresses.at(-1)!;
}

export function sessionCookieOptions(secure: boolean) {
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 60 * 60 * 24 * 30 };
}

export const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
