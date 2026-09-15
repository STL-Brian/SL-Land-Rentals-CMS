import { query } from "@lake-tech/db";

export type Listing = {
  id: string;
  slug: string;
  name: string;
  kind: "PARCEL" | "FULL_REGION";
  description: string;
  area_sqm: number;
  prims: number;
  region_name: string;
  weekly_linden: number;
  setup_linden: number;
  stripe_weekly_minor: number;
  stripe_setup_minor: number;
  stripe_currency: string;
  hero_gradient: string;
  available: boolean;
};

const unavailable = `(EXISTS(
  SELECT 1 FROM rentals r
  WHERE r.listing_id=l.id
    AND r.status IN ('PENDING','ACTIVE')
    AND r.ends_at>now()
) OR EXISTS(
  SELECT 1 FROM reservations x
  WHERE x.listing_id=l.id
    AND x.status='ACTIVE'
    AND x.expires_at>now()
))`;
const select = `SELECT l.*,p.region_name,pr.weekly_linden,pr.setup_linden,
  pr.stripe_weekly_minor,pr.stripe_setup_minor,pr.stripe_currency,NOT ${unavailable} AS available
  FROM listings l
  JOIN properties p ON p.id=l.property_id
  JOIN pricing pr ON pr.listing_id=l.id AND pr.active=true`;

export async function publicListings(kind?: string, availableOnly = false): Promise<Listing[]> {
  const where = ["l.published=true"];
  const args: unknown[] = [];
  if (kind === "PARCEL" || kind === "FULL_REGION") {
    args.push(kind);
    where.push(`l.kind=$${args.length}`);
  }
  if (availableOnly) where.push(`NOT ${unavailable}`);
  return (await query<Listing>(`${select} WHERE ${where.join(" AND ")} ORDER BY l.kind,l.name`, args)).rows;
}

export async function listingBySlug(slug: string): Promise<Listing | null> {
  return (await query<Listing>(`${select} WHERE l.slug=$1 AND l.published=true`, [slug])).rows[0] ?? null;
}
