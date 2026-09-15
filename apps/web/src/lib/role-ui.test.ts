import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../app/", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

describe("role-based multi-page application", () => {
  it("has distinct scan-focused management pages", async () => {
    const pages = await Promise.all([
      "dashboard/page.tsx", "management/listings/page.tsx", "management/rentals/page.tsx",
      "management/reservations/page.tsx", "management/payments/page.tsx", "management/terminals/page.tsx",
      "management/users/page.tsx", "management/audit/page.tsx",
    ].map(read));
    expect(pages).toHaveLength(8);
    for (const page of pages) expect(page).toMatch(/AppShell|redirect/);
  });

  it("keeps renter object reads owner-scoped", async () => {
    const route = await read("api/portal/rentals/[id]/route.ts");
    expect(route).toContain("r.user_id=$2");
    expect(route).toContain("viewer.id");
  });

  it("public availability excludes live staff reservations", async () => {
    const listings = await readFile(new URL("../lib/listings.ts", import.meta.url), "utf8");
    expect(listings).toContain("reservations");
    expect(listings).toContain("expires_at>now()");
  });

  it("uses permission checks in management APIs", async () => {
    const [reservations, users] = await Promise.all([
      read("api/management/reservations/route.ts"), read("api/management/users/[id]/route.ts"),
    ]);
    expect(reservations).toContain('authorizeApi("reservation:manage")');
    expect(users).toContain('authorizeApi("user:manage")');
  });

  it("does not disclose the full customer directory to agents", async () => {
    const [page, search] = await Promise.all([
      read("management/reservations/page.tsx"), read("api/management/reservation-users/route.ts"),
    ]);
    expect(page).not.toContain("SELECT u.id,u.display_name,s.canonical_username FROM users");
    expect(page).toContain("ReservationForm");
    expect(search).toContain('authorizeApi("reservation:manage")');
    expect(search).toContain("length<3");
    expect(search).toContain("JOIN sl_identities");
    expect(search).toContain("'RESIDENT','RENTER','ADMINISTRATOR'");
    expect(search).toContain("LIMIT 10");
  });

  it("limits checkout to renter and administrator roles", async () => {
    const checkout = await read("api/checkout/route.ts");
    expect(checkout).toContain('can(viewer.role,"checkout:create")');
    expect(await read("portal/page.tsx")).toContain("RenewalButton");
  });
});
