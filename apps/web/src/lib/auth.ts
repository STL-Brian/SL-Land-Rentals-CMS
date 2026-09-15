import type { Permission, UserRole } from "@lake-tech/core";
import { can, defaultAuthenticatedPath } from "@lake-tech/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createOtp,
  createSessionToken,
  digestOtp,
  hashSessionToken,
  sealMessage,
  verifyOtp,
} from "@lake-tech/core";
import { query, transaction } from "@lake-tech/db";
import { env } from "./env";
import { consumeLoginRateLimit } from "./rate-limit";
import { parseSecondLifeUsername, resolveSecondLifeAgentId } from "./sl-name";

export type Viewer = {
  id: string;
  role: UserRole;
  display_name: string;
  avatar_id: string;
  canonical_username: string;
};

const demoIds: Record<string, string> = {
  "avery administrator": "11111111-1111-4111-8111-111111111111",
  "mira renter": "22222222-2222-4222-8222-222222222222",
  "morgan manager": "33333333-3333-4333-8333-333333333333",
  "alex agent": "44444444-4444-4444-8444-444444444444",
  "riley resident": "55555555-5555-4555-8555-555555555555",
};

function canonicalUsername(username: string): string | null {
  try {
    return parseSecondLifeUsername(username).canonical;
  } catch {
    return null;
  }
}

export async function resolveAvatar(username: string): Promise<string | null> {
  const cfg = env();
  const canonical = canonicalUsername(username);
  if (!canonical) return null;
  if (cfg.simulation) return demoIds[canonical] ?? null;
  return resolveSecondLifeAgentId(username, cfg.slApiKey!);
}

export async function requestChallenge(username: string, ip: string): Promise<void> {
  const cfg = env();
  const canonical = canonicalUsername(username);
  if (!canonical) return;

  const allowed = await transaction(async (db) => {
    return consumeLoginRateLimit(db, "otp-create", ip, canonical, 20, 5, 600);
  });
  if (!allowed) return;

  const avatarId = await resolveAvatar(canonical);
  const resolveViaBot = cfg.simulation && process.env.SL_BOT_SIMULATION_MODE === "false";
  if (!avatarId && !resolveViaBot) return;

  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`login:${canonical}`]);
    const recent = await db.query<{ last_sent_at: Date }>(
      "SELECT last_sent_at FROM login_challenges WHERE canonical_username=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
      [canonical],
    );
    if (recent.rowCount && Date.now() - recent.rows[0]!.last_sent_at.getTime() < 60_000) return;

    // Creation and verification share this identity lock. A newly issued code
    // atomically retires every older unused code for the identity.
    await db.query("UPDATE login_challenges SET consumed_at=now() WHERE canonical_username=$1 AND consumed_at IS NULL", [canonical]);

    const id = crypto.randomUUID();
    const otp = createOtp();
    await db.query(
      `INSERT INTO login_challenges(id,avatar_id,canonical_username,otp_digest,expires_at,last_sent_at)
       VALUES($1,$2,$3,$4,now()+interval '10 minutes',now())`,
      [id, avatarId, canonical, digestOtp(otp, cfg.otpSecret, id)],
    );
    await db.query(
      "INSERT INTO bot_outbox(avatar_id,target_username,kind,payload,challenge_id,expires_at) VALUES($1,$2,'LOGIN_OTP',$3::jsonb,$4,now()+interval '10 minutes')",
      [avatarId, avatarId ? null : canonical, JSON.stringify({ sealed: sealMessage(`Lake Tech Estates login code: ${otp}. Expires in 10 minutes.`, cfg.otpSecret) }), id],
    );
  });
}

export async function verifyChallenge(username: string, code: string, ip: string): Promise<string | null> {
  const cfg = env();
  const canonical = canonicalUsername(username);
  if (!canonical) return null;

  return transaction(async (db) => {
    if (!await consumeLoginRateLimit(db, "otp-verify", ip, canonical, 50, 10, 600)) return null;

    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`login:${canonical}`]);
    const found = await db.query<{
      id: string;
      avatar_id: string | null;
      otp_digest: string;
      attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>("SELECT * FROM login_challenges WHERE canonical_username=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [canonical]);
    const challenge = found.rows[0];
    if (!challenge || !challenge.avatar_id || challenge.consumed_at || challenge.expires_at.getTime() < Date.now() || challenge.attempts >= 5) return null;

    await db.query("UPDATE login_challenges SET attempts=attempts+1 WHERE id=$1", [challenge.id]);
    if (!verifyOtp(code, challenge.otp_digest, cfg.otpSecret, challenge.id)) return null;
    await db.query("UPDATE login_challenges SET consumed_at=now() WHERE id=$1", [challenge.id]);

    const identity = await db.query<{ user_id: string }>("SELECT user_id FROM sl_identities WHERE avatar_id=$1", [challenge.avatar_id]);
    let userId = identity.rows[0]?.user_id;
    if (!userId) {
      const user = await db.query<{ id: string }>("INSERT INTO users(display_name) VALUES($1) RETURNING id", [canonical]);
      userId = user.rows[0]!.id;
      await db.query(
        "INSERT INTO sl_identities(avatar_id,user_id,canonical_username,display_name) VALUES($1,$2,$3,$3)",
        [challenge.avatar_id, userId, canonical],
      );
    }

    const token = createSessionToken();
    await db.query(
      "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [userId, hashSessionToken(token)],
    );
    await db.query(
      "INSERT INTO audit_log(actor_user_id,action,target_type,target_id) VALUES($1,'LOGIN','SESSION',$2)",
      [userId, challenge.id],
    );
    return token;
  });
}

export async function currentViewer(): Promise<Viewer | null> {
  const token = (await cookies()).get("lte_session")?.value;
  if (!token) return null;
  const result = await query<Viewer>(
    `SELECT u.id,u.role,u.display_name,sli.avatar_id,sli.canonical_username
     FROM sessions s
     JOIN users u ON u.id=s.user_id
     JOIN sl_identities sli ON sli.user_id=u.id
     WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,
    [hashSessionToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function requireViewer(permission?: Permission): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) redirect("/login");
  if (permission && !can(viewer.role, permission)) redirect(defaultAuthenticatedPath(viewer.role));
  return viewer;
}
