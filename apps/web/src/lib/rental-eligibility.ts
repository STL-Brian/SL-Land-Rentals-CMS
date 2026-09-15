interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rowCount: number | null; rows: T[] }>;
}

const RENTAL_ROLES = new Set(["RESIDENT", "RENTER", "ADMINISTRATOR"]);

export async function assertEligibleRentalUser(db: Queryable, userId: string): Promise<void> {
  const result = await db.query<{ active: boolean; role: string }>(
    "SELECT active,role FROM users WHERE id=$1 FOR UPDATE",
    [userId],
  );
  const user = result.rows[0];
  if (!user?.active || !RENTAL_ROLES.has(user.role)) throw new Error("RENTAL_USER_INELIGIBLE");
}
