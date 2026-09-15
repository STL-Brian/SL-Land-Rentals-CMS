// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RentalCard } from "./rental-card";

const listing = {
  id: "listing-a",
  slug: "moonwater-cove",
  name: "Moonwater Cove",
  kind: "PARCEL" as const,
  description: "A quiet waterfront parcel for a home, studio, or gathering place.",
  area_sqm: 4096,
  prims: 937,
  region_name: "Moonwater",
  weekly_linden: 1250,
  setup_linden: 300,
  stripe_weekly_minor: 499,
  stripe_setup_minor: 999,
  stripe_currency: "usd",
  hero_gradient: "violet",
  available: true,
};

afterEach(cleanup);

describe("public rental card", () => {
  it("keeps the listing name, description, metadata, and pricing in distinct regions", () => {
    render(<RentalCard item={listing} />);
    expect(screen.getByRole("heading", { name: "Moonwater Cove" }).classList.contains("listing-name")).toBe(true);
    expect(screen.getByText(listing.description).classList.contains("listing-description")).toBe(true);
    expect(screen.getByText(/Moonwater · Estate parcel/).parentElement?.classList.contains("listing-meta")).toBe(true);
    expect(screen.getByText(/L\$1,250 \/ week/).parentElement?.classList.contains("listing-pricing")).toBe(true);
  });
});
