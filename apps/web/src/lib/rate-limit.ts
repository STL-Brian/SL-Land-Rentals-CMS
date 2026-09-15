import { createHash } from "node:crypto";

interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: T[] }>;
}

export function fixedWindowStart(nowMs: number, windowSeconds: number): number {
  const size = windowSeconds * 1000;
  return Math.floor(nowMs / size) * size;
}

export function rateLimitAllowed(previousHits: number, limit: number): boolean {
  return previousHits < limit;
}

export async function consumeRateLimit(
  db: Queryable,
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
  nowMs = Date.now(),
): Promise<boolean> {
  const subjectHash = createHash("sha256").update(subject, "utf8").digest("hex");
  const windowStart = new Date(fixedWindowStart(nowMs, windowSeconds));
  const result = await db.query<{ hits: number }>(
    `INSERT INTO rate_limits(scope,subject_hash,window_start,hits)
     VALUES($1,$2,$3,1)
     ON CONFLICT(scope,subject_hash,window_start)
     DO UPDATE SET hits=rate_limits.hits+1
       WHERE rate_limits.hits < $4
     RETURNING hits`,
    [scope, subjectHash, windowStart, limit],
  );
  return result.rowCount === 1;
}

export async function consumeLoginRateLimit(
  db: Queryable,
  scope: string,
  ip: string,
  username: string,
  ipLimit: number,
  usernameLimit: number,
  windowSeconds: number,
  nowMs = Date.now(),
): Promise<boolean> {
  // Charge the bounded IP bucket first. Once it is full, attacker-controlled
  // usernames cannot create any additional rows in this window.
  if (!await consumeRateLimit(db, `${scope}-ip`, ip, ipLimit, windowSeconds, nowMs)) return false;
  const allowed=await consumeRateLimit(db, `${scope}-username`, username, usernameLimit, windowSeconds, nowMs);
  await db.query("DELETE FROM rate_limits WHERE window_start<$1",[new Date(nowMs-86_400_000)]);
  return allowed;
}
