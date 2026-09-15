import { execFileSync } from "node:child_process";

const base=process.argv[2]??"https://hermes-dev-2.tallofam.com";
const origin=new URL(base).origin;
const jsonHeaders={origin,"content-type":"application/json"};
const assert=(ok,message)=>{if(!ok)throw new Error(message)};
const db=(sql)=>execFileSync("docker",["compose","exec","-T","postgres","psql","-v","ON_ERROR_STOP=1","-U","lake_tech","-d","lake_tech","-Atc",sql],{encoding:"utf8"}).trim();
const identities=[
  ["avery administrator","dashboard"],
  ["morgan manager","dashboard"],
  ["alex agent","management/reservations"],
  ["mira renter","portal"],
  ["riley resident","portal"],
];
db("UPDATE users SET role='RESIDENT' WHERE id='00000000-0000-4000-8000-000000000005'; UPDATE rentals SET status='ENDED',ends_at=LEAST(ends_at,now()) WHERE listing_id='40000000-0000-4000-8000-000000000001' AND status IN ('PENDING','ACTIVE'); UPDATE rentals SET status='ENDED',ends_at=LEAST(ends_at,now()) WHERE listing_id='40000000-0000-4000-8000-000000000002' AND id<>'60000000-0000-4000-8000-000000000001' AND status IN ('PENDING','ACTIVE'); UPDATE rentals SET status='ACTIVE',ends_at=GREATEST(ends_at,now()+interval '21 days') WHERE id='60000000-0000-4000-8000-000000000001'; DELETE FROM login_challenges WHERE canonical_username IN ('avery administrator','morgan manager','alex agent','mira renter','riley resident')");
async function login(username){
  const challenge=await fetch(`${base}/api/auth/challenge`,{method:"POST",headers:jsonHeaders,body:JSON.stringify({username})});
  assert(challenge.ok,`${username}: challenge failed`);
  let code;
  for(let attempt=0;attempt<30&&!code;attempt++){
    await new Promise(resolve=>setTimeout(resolve,300));
    try{const message=execFileSync("node",["scripts/read-simulation-mailbox.mjs",username],{encoding:"utf8"});code=/\b(\d{8})\b/.exec(message)?.[1]}catch{/* delivery pending */}
  }
  assert(code,`${username}: OTP not delivered`);
  const verified=await fetch(`${base}/api/auth/verify`,{method:"POST",headers:jsonHeaders,body:JSON.stringify({username,code})});
  assert(verified.ok,`${username}: OTP verification failed`);
  const setCookie=verified.headers.get("set-cookie")??"";
  assert(/HttpOnly/i.test(setCookie)&&/SameSite=Lax/i.test(setCookie)&&/Secure/i.test(setCookie),`${username}: cookie attributes missing`);
  return setCookie.split(";",1)[0];
}
async function page(path,cookie,expectedStatus=200){const response=await fetch(`${base}/${path}`,{headers:cookie?{cookie}:{},redirect:"manual"});assert(response.status===expectedStatus,`${path}: expected ${expectedStatus}, got ${response.status}`);return response;}
async function redirected(path,cookie,target){const response=await page(path,cookie,307);assert(response.headers.get("location")?.endsWith(target),`${path}: wrong redirect ${response.headers.get("location")}`);}

const publicPage=await page("",null);const csp=publicPage.headers.get("content-security-policy")??"";assert(csp.includes("frame-ancestors 'none'")&&publicPage.headers.get("x-content-type-options")==="nosniff","security headers missing");
assert((await page("api/simulation/mailbox",null,404)).status===404,"mailbox must be absent");
await redirected("dashboard",null,"/login");
for(const api of ["api/admin/terminals","api/admin/reconciliation","api/management/reservations","api/management/reservation-users?q=mir"]){const response=await page(api,null,401);assert((await response.json()).error,"unauthenticated API did not return JSON error")}

const sessions={};for(const [username] of identities)sessions[username]=await login(username);
const admin=sessions["avery administrator"],manager=sessions["morgan manager"],agent=sessions["alex agent"],renter=sessions["mira renter"],resident=sessions["riley resident"];
for(const path of ["dashboard","management/listings","management/rentals","management/reservations","management/payments","management/terminals","management/users","management/audit","portal"])await page(path,admin);
const listingsHtml=await (await page("management/listings",admin)).text();assert(listingsHtml.includes("New property listing")&&listingsHtml.includes('aria-label="Edit '),"listing manager did not render modal launch actions");assert(!listingsHtml.includes("Parcel size (m²)"),"listing creation form was left inline");
const adminPayments=await (await page("management/payments",admin)).text();assert(["Unlinked terminal payments","Stripe event recovery","Provider actions"].every(label=>adminPayments.includes(label)),"administrator payment queues incomplete");
await redirected("admin",admin,"/dashboard");
for(const path of ["dashboard","management/listings","management/rentals","management/reservations","management/payments"])await page(path,manager);
const managerPayments=await (await page("management/payments",manager)).text();assert(!managerPayments.includes("Stripe event recovery")&&!managerPayments.includes("Provider actions"),"manager saw privileged Stripe/provider actions");
for(const path of ["management/terminals","management/users","management/audit"])await redirected(path,manager,"/dashboard");
assert((await page("api/admin/terminals",manager,403)).status===403,"manager reached terminal API");
const invalidGridResponse=await fetch(`${base}/api/admin/terminals`,{method:"POST",headers:{...jsonHeaders,cookie:admin},body:JSON.stringify({listingId:"40000000-0000-4000-8000-000000000001",objectId:crypto.randomUUID(),ownerId:crypto.randomUUID(),shard:"Agni"})});assert(invalidGridResponse.status===400,"terminal API accepted a caller-controlled grid");
await page("api/admin/reconciliation",manager);
await page("management/reservations",agent);
for(const path of ["dashboard","management/listings","management/rentals","management/payments","management/terminals","management/users","management/audit"])await redirected(path,agent,"/management/reservations");
assert((await page("api/admin/reconciliation",agent,403)).status===403,"agent reached payment API");
assert((await (await page("api/management/reservation-users?q=mi",agent)).json()).length===0,"short agent search leaked accounts");
const matches=await (await page("api/management/reservation-users?q=resident",agent)).json();assert(matches.some(item=>item.id==="00000000-0000-4000-8000-000000000005"),"typeahead account search did not match within the display name");
let bypass=await fetch(`${base}/api/management/reservations`,{method:"POST",headers:{...jsonHeaders,cookie:agent},body:JSON.stringify({listingId:"40000000-0000-4000-8000-000000000001",targetUserId:"00000000-0000-4000-8000-000000000003",expiresAt:new Date(Date.now()+60*60_000).toISOString(),notes:"Agent staff-target bypass probe",idempotencyKey:`agent-bypass-${crypto.randomUUID()}`})});assert(bypass.status===400,"agent reserved for a staff UUID through the direct API");
await page("portal",renter);await redirected("dashboard",renter,"/portal");
const ownedBefore=await (await page("api/portal/rentals/60000000-0000-4000-8000-000000000001",renter)).json();await page(`api/portal/rentals/${crypto.randomUUID()}`,renter,404);
let response=await fetch(`${base}/api/checkout`,{method:"POST",headers:{...jsonHeaders,cookie:renter},body:JSON.stringify({rentalId:"60000000-0000-4000-8000-000000000001"})});const renewal=await response.json();assert(response.ok&&renewal.url?.includes("/checkout/success?invoice="),"renter renewal checkout failed");const ownedAfter=await (await page("api/portal/rentals/60000000-0000-4000-8000-000000000001",renter)).json();assert(new Date(ownedAfter.ends_at).getTime()-new Date(ownedBefore.ends_at).getTime()===7*24*60*60_000,"renewal did not extend exactly one week");
await page("portal",resident);await redirected("dashboard",resident,"/portal");
response=await fetch(`${base}/api/checkout`,{method:"POST",headers:{...jsonHeaders,cookie:resident},body:JSON.stringify({listingId:"40000000-0000-4000-8000-000000000001"})});assert(response.status===403,"resident reached checkout");
response=await fetch(`${base}/api/management/reservations`,{method:"POST",headers:{...jsonHeaders,cookie:agent},body:JSON.stringify({listingId:"40000000-0000-4000-8000-000000000001",targetUserId:matches[0].id,expiresAt:new Date(Date.now()+60*60_000).toISOString(),notes:"Role smoke reservation",idempotencyKey:`role-smoke-${crypto.randomUUID()}`})});const reservation=await response.json();assert(response.status===201&&reservation.id,"agent reservation failed");
response=await fetch(`${base}/api/management/reservations/${reservation.id}`,{method:"DELETE",headers:{...jsonHeaders,cookie:agent},body:JSON.stringify({reason:"Automated role smoke cleanup"})});assert(response.ok,"agent could not cancel own reservation");
db("UPDATE users SET role='RESIDENT' WHERE id='00000000-0000-4000-8000-000000000005'");
console.log("HTTPS five-role login/navigation/API/IDOR/reservation/mailbox/headers: PASS");
