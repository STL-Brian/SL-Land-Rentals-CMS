import type { Permission, UserRole } from "@lake-tech/core";
import { can, defaultAuthenticatedPath } from "@lake-tech/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createOtp,
  createSessionToken,
  digestOtp,
  hashSessionToken,
  hashPassword,
  verifyPassword,
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

  const existing = await query<{ active: boolean }>("SELECT u.active FROM users u JOIN sl_identities sli ON sli.user_id=u.id WHERE sli.canonical_username=$1 LIMIT 1", [canonical]);
  if (existing.rows[0] && !existing.rows[0].active) return;

  const avatarId = await resolveAvatar(canonical);
  const resolveViaBot = process.env.SL_BOT_SIMULATION_MODE === "false";
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

export async function changePassword(userId: string, currentPassword: string, password: string): Promise<string | null> {
  return transaction(async db => {
    const found = await db.query<{ password_hash: string | null }>("SELECT password_hash FROM users WHERE id=$1 AND active FOR UPDATE", [userId]);
    const currentHash = found.rows[0]?.password_hash;
    if (!currentHash || !await verifyPassword(currentPassword, currentHash)) return null;
    const passwordHash = await hashPassword(password);
    const token = createSessionToken();
    await db.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
    const updated = await db.query("UPDATE users SET password_hash=$2,password_changed_at=now() WHERE id=$1 AND active RETURNING id", [userId, passwordHash]);
    if (!updated.rowCount) return null;
    await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')", [userId, hashSessionToken(token)]);
    await db.query("INSERT INTO audit_log(actor_user_id,action,target_type,target_id) VALUES($1,'PASSWORD_CHANGED','USER',$1)", [userId]);
    return token;
  });
}

export async function setPassword(userId: string, password: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  return transaction(async db => {
    await db.query("SELECT id FROM users WHERE id=$1 AND active FOR UPDATE", [userId]);
    const token = createSessionToken();
    await db.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
    const updated = await db.query("UPDATE users SET password_hash=$2,password_set_at=now(),password_changed_at=now() WHERE id=$1 AND active RETURNING id", [userId, passwordHash]);
    if (!updated.rowCount) throw new Error("active user required");
    await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')", [userId, hashSessionToken(token)]);
    return token;
  });
}
export async function completePasswordSetup(grant: string, password: string, ip: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(grant)) return null;
  const tokenHash = hashSessionToken(grant);
  const eligible = await transaction(async db => {
    const found = await db.query<{ user_id: string; canonical_username: string }>("SELECT g.user_id,g.canonical_username FROM auth_grants g JOIN users u ON u.id=g.user_id AND u.active WHERE g.token_hash=$1 AND g.purpose='PASSWORD_SETUP' AND g.consumed_at IS NULL AND g.expires_at>now() FOR UPDATE", [tokenHash]);
    if (!found.rowCount || !await consumeLoginRateLimit(db, "password-setup", ip, found.rows[0]!.canonical_username, 10, 5, 600)) return null;
    return found.rows[0]!.user_id;
  });
  if (!eligible) return null;
  const passwordHash = await hashPassword(password);
  return transaction(async db => {
    const found = await db.query<{ user_id: string }>("SELECT g.user_id FROM auth_grants g JOIN users u ON u.id=g.user_id AND u.active WHERE g.token_hash=$1 AND g.purpose='PASSWORD_SETUP' AND g.consumed_at IS NULL AND g.expires_at>now() FOR UPDATE", [tokenHash]);
    const userId = found.rows[0]?.user_id;
    if (!userId || userId !== eligible) return null;
    await db.query("UPDATE auth_grants SET consumed_at=now() WHERE token_hash=$1", [tokenHash]);
    const updated = await db.query("UPDATE users SET password_hash=$2,password_set_at=now(),password_changed_at=now() WHERE id=$1 AND active RETURNING id", [userId, passwordHash]);
    if (!updated.rowCount) throw new Error("active user required");
    const token = createSessionToken();
    await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')", [userId, hashSessionToken(token)]);
    return token;
  });
}

export async function loginWithPassword(username: string, password: string, ip: string): Promise<{ token: string; redirect: string } | null> {
  const canonical = canonicalUsername(username);
  if (!canonical) return null;
  const allowed = await transaction(async db => consumeLoginRateLimit(db, "password-login", ip, canonical, 50, 10, 600));
  if (!allowed) return null;
  const found = await query<{ id: string; password_hash: string | null; active: boolean }>(
    "SELECT u.id,u.password_hash,u.active FROM users u JOIN sl_identities sli ON sli.user_id=u.id WHERE sli.canonical_username=$1 LIMIT 1",
    [canonical],
  );
  const dummy = "scrypt$v=1$N=32768,r=8,p=1$BwcHBwcHBwcHBwcHBwcHBw$OvsRFgO9yfS37w4tzhlwIbqD_Ni5YJstNlKr0Zf-_E4";
  const valid = await verifyPassword(password, found.rows[0]?.password_hash ?? dummy);
  if (!valid || !found.rows[0]?.active || !found.rows[0].password_hash) return null;
  return transaction(async db => {
    const token = createSessionToken();
    await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')", [found.rows[0]!.id, hashSessionToken(token)]);
    await db.query("INSERT INTO audit_log(actor_user_id,action,target_type,target_id) VALUES($1,'LOGIN','SESSION',$2)", [found.rows[0]!.id, hashSessionToken(token)]);
    const role = (await db.query<{ role: UserRole }>("SELECT role FROM users WHERE id=$1 AND active", [found.rows[0]!.id])).rows[0]?.role;
    if (!role) return null;
    return { token, redirect: defaultAuthenticatedPath(role) };
  });
}
export async function verifyChallenge(username: string, code: string, ip: string): Promise<string | { token: string; redirect: string } | null> {
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

    const identity = await db.query<{ user_id: string; password_hash: string | null }>("SELECT sli.user_id,u.password_hash FROM sl_identities sli JOIN users u ON u.id=sli.user_id AND u.active WHERE sli.avatar_id=$1", [challenge.avatar_id]);
    let userId = identity.rows[0]?.user_id;
    const requiresPasswordSetup = !identity.rows[0]?.password_hash;
    if (!userId) {
      const user = await db.query<{ id: string }>("INSERT INTO users(display_name) VALUES($1) RETURNING id", [canonical]);
      userId = user.rows[0]!.id;
      await db.query(
        "INSERT INTO sl_identities(avatar_id,user_id,canonical_username,display_name) VALUES($1,$2,$3,$3)",
        [challenge.avatar_id, userId, canonical],
      );
    }

    if (requiresPasswordSetup) {
      const setupToken = createSessionToken();
      await db.query("INSERT INTO auth_grants(user_id,avatar_id,canonical_username,purpose,token_hash,expires_at) VALUES($1,$2,$3,'PASSWORD_SETUP',$4,now()+interval '15 minutes')", [userId, challenge.avatar_id, canonical, hashSessionToken(setupToken)]);
      return `SETUP:${setupToken}`;
    }
    const role = (await db.query<{ role: UserRole }>("SELECT role FROM users WHERE id=$1 AND active", [userId])).rows[0]?.role;
    if (!role) return null;
    const token = createSessionToken();
    await db.query(
      "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '30 days')",
      [userId, hashSessionToken(token)],
    );
    await db.query(
      "INSERT INTO audit_log(actor_user_id,action,target_type,target_id) VALUES($1,'LOGIN','SESSION',$2)",
      [userId, challenge.id],
    );
    return { token, redirect: defaultAuthenticatedPath(role) };
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
