import { afterEach, describe, expect, it } from "vitest";
import pg from "pg";
import { openMessage, verifyOtp } from "@lake-tech/core";
import { completePasswordSetup, requestChallenge, verifyChallenge } from "./auth.js";

const url = process.env.DATABASE_URL;
const run = url ? it : it.skip;
const touched: string[] = [];
const envKeys = ["SIMULATION_MODE", "SL_BOT_SIMULATION_MODE", "OTP_HMAC_SECRET", "SESSION_HMAC_SECRET", "TERMINAL_SECRET_ENCRYPTION_KEY", "PUBLIC_SCHEME", "PUBLIC_BASE_URL"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(async () => {
  if (!url || touched.length === 0) return;
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    for (const canonical of touched.splice(0)) {
      await db.query("DELETE FROM audit_log WHERE actor_user_id IN (SELECT user_id FROM sl_identities WHERE canonical_username=$1)", [canonical]);
      await db.query("DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM sl_identities WHERE canonical_username=$1)", [canonical]);
      await db.query("DELETE FROM users WHERE id IN (SELECT user_id FROM sl_identities WHERE canonical_username=$1)", [canonical]);
      await db.query("DELETE FROM login_challenges WHERE canonical_username=$1", [canonical]);
    }
  } finally {
    await db.end();
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

describe("first Second Life login", () => {
  run("queues unknown names for bot resolution and provisions a Resident only after OTP proof", async () => {
    const canonical = `first-${crypto.randomUUID()} resident`;
    touched.push(canonical);
    process.env.SIMULATION_MODE = "true";
    process.env.SL_BOT_SIMULATION_MODE = "false";
    process.env.OTP_HMAC_SECRET = "test-otp-secret-that-is-at-least-32-bytes";
    process.env.SESSION_HMAC_SECRET = "test-session-secret-that-is-32-bytes";
    process.env.TERMINAL_SECRET_ENCRYPTION_KEY = "test-terminal-secret-that-is-32bytes";
    process.env.PUBLIC_SCHEME = "http";
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";

    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
    await requestChallenge(canonical, ip);
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try {
      const queued = await db.query<{ id: string; avatar_id: string | null; target_username: string; sealed: string }>(
        "SELECT o.challenge_id AS id,o.avatar_id,o.target_username,o.payload->>'sealed' AS sealed FROM bot_outbox o JOIN login_challenges c ON c.id=o.challenge_id WHERE c.canonical_username=$1 AND o.sent_at IS NULL",
        [canonical],
      );
      expect(queued.rows).toHaveLength(1);
      const row = queued.rows[0]!;
      expect(row).toMatchObject({ avatar_id: null, target_username: canonical });
      const before = await db.query("SELECT 1 FROM sl_identities WHERE canonical_username=$1", [canonical]);
      expect(before.rowCount).toBe(0);

      const avatarId = crypto.randomUUID();
      const challenge = await db.query<{ otp_digest: string }>("UPDATE login_challenges SET avatar_id=$2 WHERE id=$1 RETURNING otp_digest", [row.id, avatarId]);
      const message = openMessage(row.sealed, process.env.OTP_HMAC_SECRET!);
      const otp = message.match(/code: (\d{8})/)?.[1];
      expect(otp).toMatch(/^\d{8}$/);
      expect(verifyOtp(otp!, challenge.rows[0]!.otp_digest, process.env.OTP_HMAC_SECRET!, row.id)).toBe(true);

      const setup = await verifyChallenge(canonical, otp!, ip);
      expect(setup).toMatch(/^SETUP:/);
      const session = await completePasswordSetup(setup!.slice(6), "correct horse battery staple", ip);
      expect(session).not.toBeNull();
      const provisioned = await db.query("SELECT u.role,i.avatar_id FROM users u JOIN sl_identities i ON i.user_id=u.id WHERE i.canonical_username=$1", [canonical]);
      expect(provisioned.rows).toEqual([{ role: "RESIDENT", avatar_id: avatarId }]);
    } finally {
      await db.end();
    }
  }, 15_000);
});
