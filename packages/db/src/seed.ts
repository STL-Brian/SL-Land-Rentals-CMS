import { pool } from "./index.js";

const db = pool();
await db.query("BEGIN");
try {
  await db.query(`INSERT INTO users(id,role,display_name) VALUES
    ('00000000-0000-4000-8000-000000000001','ADMINISTRATOR','Avery Administrator'),
    ('00000000-0000-4000-8000-000000000002','RENTER','Mira Renter'),
    ('00000000-0000-4000-8000-000000000003','MANAGER','Morgan Manager'),
    ('00000000-0000-4000-8000-000000000004','AGENT','Alex Agent'),
    ('00000000-0000-4000-8000-000000000005','RESIDENT','Riley Resident')
    ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,role=EXCLUDED.role`);
  await db.query(`INSERT INTO sl_identities(avatar_id,user_id,canonical_username,display_name) VALUES
    ('11111111-1111-4111-8111-111111111111','00000000-0000-4000-8000-000000000001','avery administrator','Avery Administrator'),
    ('22222222-2222-4222-8222-222222222222','00000000-0000-4000-8000-000000000002','mira renter','Mira Renter'),
    ('33333333-3333-4333-8333-333333333333','00000000-0000-4000-8000-000000000003','morgan manager','Morgan Manager'),
    ('44444444-4444-4444-8444-444444444444','00000000-0000-4000-8000-000000000004','alex agent','Alex Agent'),
    ('55555555-5555-4555-8555-555555555555','00000000-0000-4000-8000-000000000005','riley resident','Riley Resident')
    ON CONFLICT(avatar_id) DO UPDATE SET canonical_username=EXCLUDED.canonical_username,display_name=EXCLUDED.display_name`);
  await db.query(`INSERT INTO properties(id,name,region_name,grid_x,grid_y) VALUES
    ('30000000-0000-4000-8000-000000000001','Moonwater Cove','Moonwater Cove',1001,1002),
    ('30000000-0000-4000-8000-000000000002','Astraea Island','Astraea Island',1003,1004)
    ON CONFLICT(id) DO NOTHING`);
  await db.query(`INSERT INTO listings(id,property_id,slug,name,kind,description,area_sqm,prims,published,hero_gradient) VALUES
    ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','moonwater-cove-parcel','Moonwater Cove Parcel','PARCEL','A waterfront parcel with open sunset views, protected sailing access, and generous building capacity.',4096,937,true,'cyan'),
    ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','astraea-full-region','Astraea Full Region','FULL_REGION','A private full-region estate with terrain control, concierge setup, and room for an ambitious destination.',65536,20000,true,'violet')
    ON CONFLICT(id) DO UPDATE SET published=true`);
  await db.query(`INSERT INTO pricing(id,listing_id,weekly_linden,setup_linden,stripe_currency,stripe_weekly_minor,stripe_setup_minor) VALUES
    ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1800,0,'usd',799,0),
    ('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',15900,2500,'usd',6499,1000)
    ON CONFLICT(id) DO NOTHING`);
  await db.query(`INSERT INTO rentals(id,listing_id,user_id,status,starts_at,ends_at) VALUES
    ('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','ACTIVE',now()-interval '7 days',now()+interval '21 days')
    ON CONFLICT(id) DO NOTHING`);
  await db.query(`INSERT INTO invoices(id,rental_id,listing_id,user_id,status,amount_linden,due_at) VALUES
    ('70000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','PAID',15900,now()-interval '7 days')
    ON CONFLICT(id) DO NOTHING`);
  await db.query(`INSERT INTO payments(id,invoice_id,provider,provider_reference,amount_linden,status) VALUES
    ('80000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','LINDEN','seed-demo-payment',15900,'CONFIRMED')
    ON CONFLICT(provider,provider_reference) DO NOTHING`);


  await db.query("COMMIT");
  console.log("seed complete");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
