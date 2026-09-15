import type { UserRole } from "@lake-tech/core";
import { assertPermission } from "@lake-tech/core";
import { transaction } from "@lake-tech/db";

export async function changeUserRole(actorUserId: string, targetUserId: string, role: UserRole, reason: string): Promise<void> {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('administrator-role-mutation'))");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`user-role:${targetUserId}`]);
    const actor = await db.query<{ role: UserRole; active: boolean }>("SELECT role,active FROM users WHERE id=$1 FOR UPDATE", [actorUserId]);
    if (!actor.rows[0]?.active) throw new Error("FORBIDDEN");
    assertPermission(actor.rows[0].role, "user:manage");
    const target = await db.query<{ role: UserRole; active: boolean }>("SELECT role,active FROM users WHERE id=$1 FOR UPDATE", [targetUserId]);
    if (!target.rows[0]) throw new Error("NOT_FOUND");
    if (target.rows[0].role === "ADMINISTRATOR" && role !== "ADMINISTRATOR" && target.rows[0].active) {
      const admins = await db.query<{ count: string }>("SELECT count(*)::text count FROM users WHERE role='ADMINISTRATOR' AND active");
      if (Number(admins.rows[0]?.count ?? 0) <= 1) throw new Error("LAST_ADMINISTRATOR");
    }
    if (role !== "RENTER" && role !== "ADMINISTRATOR") {
      const liveRental = await db.query(
        "SELECT 1 FROM rentals WHERE user_id=$1 AND status IN ('PENDING','ACTIVE') AND ends_at>now() FOR UPDATE",
        [targetUserId],
      );
      if (liveRental.rowCount) throw new Error("ACTIVE_RENTAL_ROLE_CONFLICT");
    }
    if (target.rows[0].role === role) return;
    await db.query("UPDATE users SET role=$2 WHERE id=$1", [targetUserId, role]);
    await db.query("DELETE FROM sessions WHERE user_id=$1", [targetUserId]);
    await db.query(
      "INSERT INTO audit_log(actor_user_id,action,target_type,target_id,details) VALUES($1,'ROLE_CHANGED','USER',$2,$3::jsonb)",
      [actorUserId, targetUserId, JSON.stringify({ from: target.rows[0].role, to: role, reason })],
    );
  });
}
