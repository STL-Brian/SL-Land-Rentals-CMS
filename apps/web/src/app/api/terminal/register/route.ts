import { NextResponse } from "next/server";
import { isIP } from "node:net";
import { assertFreshTimestamp, openTerminalSecret, verifyTerminalSignature } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";
import { env } from "../../../../lib/env";

function h(req: Request, name: string): string { return req.headers.get(name) ?? ""; }
function callbackUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("invalid callback URL");
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host.endsWith(".secondlife.io") || host.endsWith(".lindenlab.com")) || url.username || url.password || url.hash) throw new Error("invalid callback URL");
  const ipv4 = /^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(host);
  if (isIP(host.replace(/^\[|\]$/g, "")) === 6) throw new Error("literal IPv6 callback URL");
  if (ipv4) {
    const a = Number(ipv4[1]); const b = Number(ipv4[2]); const c = Number(ipv4[3]); const d = Number(ipv4[4]);
    if ([a,b,c,d].some(value => value > 255) || a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) throw new Error("private callback URL");
  }
  return url.toString();
}

export async function POST(req: Request) {
  const cfg = env();
  const timestamp = h(req, "x-sl-timestamp"); const nonce = h(req, "x-sl-nonce"); const eventId = h(req, "x-sl-event-id");
  const objectId = h(req, "x-sl-object-id"); const ownerId = h(req, "x-sl-owner-id"); const shard = h(req, "x-sl-shard"); const signature = h(req, "x-sl-signature");
  try {
    if (!timestamp || !nonce || !eventId || !objectId || !ownerId || shard !== "Second Life" || !signature) throw new Error("missing terminal headers");
    assertFreshTimestamp(timestamp);
    const body = await req.text();
    const input = JSON.parse(body) as { terminalId?: unknown; callbackUrl?: unknown; generation?: unknown };
    const url = callbackUrl(input.callbackUrl);
    const generation = input.generation;
    if (!Number.isSafeInteger(generation) || (generation as number) < 1) throw new Error("invalid generation");
    await transaction(async db => {
      const found = await db.query<{ id: string; secret_ciphertext: string; callback_generation: number }>("SELECT id,secret_ciphertext,callback_generation FROM terminals WHERE object_id=$1 AND owner_id=$2 AND shard=$3 AND enabled FOR UPDATE", [objectId, ownerId, shard]);
      const terminal = found.rows[0]; if (!terminal) throw new Error("terminal verification failed");
      if (input.terminalId !== undefined && input.terminalId !== terminal.id) throw new Error("terminal verification failed");
      const secret = openTerminalSecret(terminal.secret_ciphertext, cfg.terminalEncryptionKey);
      if (!verifyTerminalSignature({ timestamp, nonce, eventId, body }, secret, signature)) throw new Error("terminal verification failed");
      const nonceResult = await db.query("INSERT INTO terminal_nonces(terminal_id,nonce) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING nonce", [terminal.id, nonce]);
      if (!nonceResult.rowCount) throw new Error("terminal replay");
      if ((generation as number) <= terminal.callback_generation) return;
      await db.query("UPDATE terminals SET callback_url=$2,callback_generation=$3,callback_registered_at=now(),last_seen_at=now() WHERE id=$1", [terminal.id, url, generation]);
    });
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.json({ error: "Terminal registration rejected" }, { status: 401, headers: { "cache-control": "no-store" } }); }
}
