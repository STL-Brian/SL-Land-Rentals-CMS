import { describe, expect, it } from "vitest";
import { assertEligibleRentalUser } from "./rental-eligibility";

function dbWith(user: { active: boolean; role: string } | undefined) {
  return { query: async <T extends Record<string, unknown> = Record<string, unknown>>() => ({ rows: (user ? [user] : []) as unknown as T[], rowCount: user ? 1 : 0 }) };
}

describe("rental owner eligibility", () => {
  it.each(["RESIDENT", "RENTER", "ADMINISTRATOR"])("accepts an active %s", async (role) => {
    await expect(assertEligibleRentalUser(dbWith({ active: true, role }), "user-a")).resolves.toBeUndefined();
  });

  it.each([
    { active: false, role: "RESIDENT" },
    { active: true, role: "MANAGER" },
    { active: true, role: "AGENT" },
    undefined,
  ])("rejects an ineligible account %#", async (user) => {
    await expect(assertEligibleRentalUser(dbWith(user), "user-a")).rejects.toThrow("RENTAL_USER_INELIGIBLE");
  });
});
