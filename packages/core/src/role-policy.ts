export const USER_ROLES = ["ADMINISTRATOR", "MANAGER", "AGENT", "RENTER", "RESIDENT"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  "dashboard:view",
  "listing:manage",
  "rental:manage",
  "reservation:manage",
  "payment:view",
  "payment:reconcile",
  "terminal:manage",
  "user:manage",
  "audit:view",
  "portal:view",
  "checkout:create",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const grants: Record<UserRole, ReadonlySet<Permission>> = {
  ADMINISTRATOR: new Set(PERMISSIONS),
  MANAGER: new Set(["dashboard:view", "listing:manage", "rental:manage", "reservation:manage", "payment:view", "payment:reconcile"]),
  AGENT: new Set(["reservation:manage"]),
  RENTER: new Set(["portal:view", "checkout:create"]),
  RESIDENT: new Set(["portal:view"]),
};

export function can(role: UserRole, permission: Permission): boolean {
  return grants[role].has(permission);
}

export function assertPermission(role: UserRole, permission: Permission): void {
  if (!can(role, permission)) throw new Error("FORBIDDEN");
}

export function defaultAuthenticatedPath(role: UserRole): string {
  if (role === "AGENT") return "/management/reservations";
  if (role === "RENTER" || role === "RESIDENT") return "/portal";
  return "/dashboard";
}

export type NavigationItem = { href: string; label: string; permission: Permission };
const navigation: NavigationItem[] = [
  { href: "/dashboard", label: "Overview", permission: "dashboard:view" },
  { href: "/management/listings", label: "Listings & pricing", permission: "listing:manage" },
  { href: "/management/rentals", label: "Rentals", permission: "rental:manage" },
  { href: "/management/reservations", label: "Reservations", permission: "reservation:manage" },
  { href: "/management/payments", label: "Payments", permission: "payment:view" },
  { href: "/management/terminals", label: "Terminals", permission: "terminal:manage" },
  { href: "/management/users", label: "Users & roles", permission: "user:manage" },
  { href: "/management/audit", label: "Audit & health", permission: "audit:view" },
];

export function managementNavigation(role: UserRole): NavigationItem[] {
  return navigation.filter((item) => can(role, item.permission));
}
