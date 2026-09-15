import { describe, expect, it } from "vitest";
import {
  can,
  defaultAuthenticatedPath,
  managementNavigation,
  type Permission,
  type UserRole,
} from "./role-policy.js";

const all: UserRole[] = ["ADMINISTRATOR", "MANAGER", "AGENT", "RENTER", "RESIDENT"];
const expected: Record<Permission, UserRole[]> = {
  "dashboard:view": ["ADMINISTRATOR", "MANAGER"],
  "listing:manage": ["ADMINISTRATOR", "MANAGER"],
  "rental:manage": ["ADMINISTRATOR", "MANAGER"],
  "reservation:manage": ["ADMINISTRATOR", "MANAGER", "AGENT"],
  "payment:view": ["ADMINISTRATOR", "MANAGER"],
  "payment:reconcile": ["ADMINISTRATOR", "MANAGER"],
  "terminal:manage": ["ADMINISTRATOR"],
  "user:manage": ["ADMINISTRATOR"],
  "audit:view": ["ADMINISTRATOR"],
  "portal:view": ["ADMINISTRATOR", "RENTER", "RESIDENT"],
  "checkout:create": ["ADMINISTRATOR", "RENTER"],
};

describe("central role permission policy", () => {
  for (const [permission, allowed] of Object.entries(expected) as [Permission, UserRole[]][]) {
    it(`${permission} is explicit for every role`, () => {
      for (const role of all) expect(can(role, permission), role).toBe(allowed.includes(role));
    });
  }

  it("sends operations roles to a dashboard and customer roles to the portal", () => {
    expect(defaultAuthenticatedPath("ADMINISTRATOR")).toBe("/dashboard");
    expect(defaultAuthenticatedPath("MANAGER")).toBe("/dashboard");
    expect(defaultAuthenticatedPath("AGENT")).toBe("/management/reservations");
    expect(defaultAuthenticatedPath("RENTER")).toBe("/portal");
    expect(defaultAuthenticatedPath("RESIDENT")).toBe("/portal");
  });

  it("does not leak unauthorized navigation destinations", () => {
    expect(managementNavigation("AGENT").map((item) => item.href)).toEqual(["/management/reservations"]);
    expect(managementNavigation("MANAGER").map((item) => item.href)).toEqual([
      "/dashboard", "/management/listings", "/management/rentals", "/management/reservations", "/management/payments",
    ]);
    expect(managementNavigation("RESIDENT")).toEqual([]);
  });
});
