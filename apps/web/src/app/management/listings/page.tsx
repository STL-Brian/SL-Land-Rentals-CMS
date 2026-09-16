import { query } from "@lake-tech/db";
import { requireViewer } from "../../../lib/auth";
import { AppShell } from "../../../components/app-shell";
import { ListingsManager } from "../../../components/inventory-form";

export const dynamic="force-dynamic";

export default async function Listings(){
  const viewer=await requireViewer("listing:manage");
  const rows=await query<{
    id:string;name:string;slug:string;kind:string;regionName:string;description:string;areaSqm:number;prims:number;published:boolean;weekly_linden:number;setup_linden:number;
    stripe_weekly_minor:number;stripe_setup_minor:number;stripe_currency:string;
  }>(`SELECT l.id,l.name,l.slug,l.kind,l.description,l.area_sqm AS "areaSqm",l.prims,pj.region_name AS "regionName",l.published,p.weekly_linden,p.setup_linden,
      p.stripe_weekly_minor,p.stripe_setup_minor,p.stripe_currency
      FROM listings l JOIN properties pj ON pj.id=l.property_id JOIN pricing p ON p.listing_id=l.id AND p.active ORDER BY l.name`);
  const listings=rows.rows.map((row)=>({
    id:row.id,name:row.name,slug:row.slug,kind:row.kind,regionName:row.regionName,description:row.description,areaSqm:row.areaSqm,prims:row.prims,published:row.published,
    weeklyLinden:row.weekly_linden,setupLinden:row.setup_linden,
    stripeWeeklyMinor:row.stripe_weekly_minor,stripeSetupMinor:row.stripe_setup_minor,
    stripeCurrency:row.stripe_currency.trim().toUpperCase(),
  }));
  return <AppShell viewer={viewer} eyebrow="Management / Inventory" title="Listings & pricing">
    <ListingsManager listings={listings}/>
  </AppShell>;
}
