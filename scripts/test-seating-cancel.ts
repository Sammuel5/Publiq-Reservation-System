/** Integration and mobile regression, using only a disposable replica-set DB and test server. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { chromium, devices } from "playwright";
import { seal } from "../src/lib/customer-auth/crypto";
import { addDaysToDateString, getClubNow } from "../src/lib/utils/datetime";

async function main() {
 const dbName=process.env.MONGODB_DB_NAME??"";if(!/^publiq_booking_test_[a-f0-9]{12}$/.test(dbName))throw Error("Requires disposable DB");
 const base="http://localhost:3001", secret="testing-session-secret-which-is-at-least-32-bytes";
 await mongoose.connect(process.env.MONGODB_URI!,{dbName});const db=mongoose.connection.db!;
 let browser:Awaited<ReturnType<typeof chromium.launch>> | undefined;
 try {
  await db.collection("club_settings").insertOne({singleton:true,clubName:"Test",openingTime:"21:00",closingTime:"04:00",timezone:"Asia/Manila",operatingDays:[0,1,2,3,4,5,6]});
  const email="staff@example.test",password="Test-Passphrase-5410!";
  await db.collection("admin_users").insertOne({name:"Staff Tester",email,passwordHash:await bcrypt.hash(password,10),role:"STAFF",isActive:true,failedLoginAttempts:0,lockedUntil:null,passwordChangedAt:new Date(),createdAt:new Date(),updatedAt:new Date()});
  const night=addDaysToDateString(getClubNow(new Date(),"Asia/Manila").date,8);
  const body=(seat="VIP 1")=>({seat,night,time:"21:00",guests:6,name:"Guest Tester",mobile:"09171234567",requestId:randomUUID()});
  const post=(payload:unknown,sub:string)=>fetch(`${base}/api/seating-bookings`,{method:"POST",headers:{Origin:base,"Content-Type":"application/json",Cookie:`publiq_customer_session=${seal({sub,email:`${sub}@example.test`,name:"Guest",exp:Date.now()+3600000},secret)}`},body:JSON.stringify(payload)});
  const firstBody=body();const first=await post(firstBody,"guest-one");assert.equal(first.status,201);const ref=(await first.json()).booking.reference;const original=await db.collection("publiq_seating_bookings").findOne({reference:ref});assert.ok(original);
  const url=`${base}/api/admin/seating-bookings/${original._id}/cancel`;
  const anonymous=await fetch(url,{method:"POST",headers:{Origin:base}});assert.equal(anonymous.status,401);assert.equal(await db.collection("publiq_night_claims").countDocuments({reference:ref}),1);
  browser=await chromium.launch();const context=await browser.newContext(devices["Pixel 5"]);const login=await context.request.post(`${base}/api/auth/login`,{headers:{Origin:base},data:{email,password}});assert.equal(login.status(),200);
  // Test retired entry points as a real ADMIN, who formerly had create access.
  const adminEmail="admin@example.test";
  await db.collection("admin_users").insertOne({name:"Admin Tester",email:adminEmail,passwordHash:await bcrypt.hash(password,10),role:"ADMIN",isActive:true,failedLoginAttempts:0,lockedUntil:null,passwordChangedAt:new Date(),createdAt:new Date(),updatedAt:new Date()});
  const adminContext=await browser.newContext();
  assert.equal((await adminContext.request.post(`${base}/api/auth/login`,{headers:{Origin:base},data:{email:adminEmail,password}})).status(),200);
  for (const [method,path] of [["POST","/api/admin/reservations"],["PATCH","/api/admin/reservations/000000000000000000000001"],["POST","/api/admin/reservations/000000000000000000000001/move"],["POST","/api/admin/blocks"],["POST","/api/admin/rooms"],["GET","/api/admin/reservations"],["GET","/api/admin/blocks"]] as const) {
    const res=await adminContext.request.fetch(`${base}${path}`,{method,headers:{Origin:base,"Content-Type":"application/json"},...(method!=="GET"?{data:{}}:{})});
    assert.equal(res.status(),410,`${method} ${path}`);
  }
  for (const path of ["/admin/calendar","/admin/blocks","/admin/rooms","/admin/reservations/000000000000000000000001"]) {
    const res=await adminContext.request.get(`${base}${path}`,{maxRedirects:0});assert.equal(res.status(),307, path);assert.match(res.headers().location ?? "",/\/admin\/reservations$/);
  }
  assert.equal((await fetch(`${base}/api/availability`)).status,410);
  assert.equal((await fetch(`${base}/api/reservations`,{method:"POST"})).status,410);
  assert.equal((await fetch(`${base}/api/reservations/lookup`,{method:"POST"})).status,410);
  assert.equal((await fetch(`${base}/api/reservations/cancel`,{method:"POST"})).status,410);
  assert.equal(await db.collection("reservations").countDocuments(),0);
  await adminContext.close();console.log("✓ Legacy public and authenticated admin booking/inventory endpoints disabled; old screens redirect");
  const cross=await context.request.post(url,{headers:{Origin:"https://untrusted.example"}});assert.equal(cross.status(),403);assert.equal(await db.collection("publiq_night_claims").countDocuments({reference:ref}),1);
  const page=await context.newPage();await page.goto(`${base}/admin/reservations`);const card=page.locator(`[data-website-booking="${ref}"]`);await card.getByRole("button",{name:"Cancel booking"}).click();const dialog=page.getByRole("dialog");assert.match(await dialog.innerText(),/releases the space/);await dialog.getByRole("button",{name:"Yes, cancel booking"}).click();await dialog.waitFor({state:"hidden"});await page.getByText("CANCELLED",{exact:true}).first().waitFor();
  assert.equal((await db.collection("publiq_seating_bookings").findOne({_id:original._id}))?.status,"CANCELLED");assert.equal(await db.collection("publiq_night_claims").countDocuments({reference:ref}),0);assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:ref,kind:"cancelled",recipient:"guest-one@example.test"}),1);
  const replay=await post(firstBody,"guest-one");assert.equal(replay.status,409);
  const replacement=await post(body(),"guest-two");assert.equal(replacement.status,201);const newRef=(await replacement.json()).booking.reference;assert.equal(await db.collection("publiq_night_claims").countDocuments({reference:newRef}),1);
  const repeat=await context.request.post(url,{headers:{Origin:base}});assert.equal(repeat.status(),200);assert.equal((await repeat.json()).alreadyCancelled,true);assert.equal(await db.collection("publiq_night_claims").countDocuments({reference:newRef}),1);assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:ref,kind:"cancelled"}),1);
  // A duplicate outbox id forces the transaction to fail: the status and seat claim must remain intact.
  const created=await post(body("VIP 2"),"guest-three");assert.equal(created.status,201);const ref2=(await created.json()).booking.reference;const rec2=await db.collection("publiq_seating_bookings").findOne({reference:ref2});assert.ok(rec2);await db.collection("publiq_email_outbox").insertOne({_id:`${ref2}:cancelled` as never,reference:ref2,kind:"fixture"});
  const failed=await context.request.post(`${base}/api/admin/seating-bookings/${rec2._id}/cancel`,{headers:{Origin:base}});assert.equal(failed.status(),500);assert.equal((await db.collection("publiq_seating_bookings").findOne({_id:rec2._id}))?.status,"CONFIRMED");assert.equal(await db.collection("publiq_night_claims").countDocuments({reference:ref2}),1);
  // Combined bookings are disabled pending capacity, but release both physical
  // claims if a valid combined record is eventually present.
  const combinedNight=addDaysToDateString(night,1), combinedRef="PUB-COMBINED-TEST";
  const combined=await db.collection("publiq_seating_bookings").insertOne({reference:combinedRef,seat:"VIP 3 + 4",night:combinedNight,time:"21:00",guests:8,minimumCentavos:700000,status:"CONFIRMED",googleEmail:"combined@example.test"});
  await db.collection("publiq_night_claims").insertMany([{seat:"VIP 3",night:combinedNight,reference:combinedRef},{seat:"VIP 4",night:combinedNight,reference:combinedRef}]);
  const both=await Promise.all([1,2].map(()=>context.request.post(`${base}/api/admin/seating-bookings/${combined.insertedId}/cancel`,{headers:{Origin:base}})));assert.ok(both.every(r=>r.status()===200));assert.equal(await db.collection("publiq_night_claims").countDocuments({reference:combinedRef}),0);assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:combinedRef,kind:"cancelled"}),1);
  console.log("✓ Combined-seat release and concurrent cancellation idempotency tested against synthetic record");
  await context.close();console.log("✓ Staff mobile cancellation: auth, cross-origin, confirmation, cancellation and reopen for a new guest");console.log("✓ Retried cancellation preserves replacement claim and queues one email; forced error rolls back status and claim");
 } finally {await browser?.close();await db.dropDatabase();await mongoose.disconnect();console.log(`Deleted disposable DB ${dbName}`);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
