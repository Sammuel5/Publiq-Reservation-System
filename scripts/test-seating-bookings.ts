/** Integration test: requires a disposable replica-set DB and a test server. Never use on a real DB. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { chromium, webkit, devices } from "playwright";
import { seal } from "../src/lib/customer-auth/crypto";
import { seatsClaimed } from "../src/lib/services/publiq-bookings/policy";
import { addDaysToDateString, getClubNow } from "../src/lib/utils/datetime";

async function main() {
const dbName=process.env.MONGODB_DB_NAME??"";
if(!/^publiq_booking_test_[a-f0-9]{12}$/.test(dbName))throw new Error("Refusing to test outside a randomly named disposable database");
const base="http://localhost:3001",secret="testing-session-secret-which-is-at-least-32-bytes";
await mongoose.connect(process.env.MONGODB_URI!,{dbName});
const db=mongoose.connection.db!;
await db.collection("club_settings").insertOne({singleton:true,clubName:"Test PUBLIQ",address:"Level 3, The Grand Strip, Bacoor, Cavite, Philippines",openingTime:"21:00",closingTime:"04:00",timezone:"Asia/Manila",operatingDays:[0,1,2,3,4,5,6]});
const night=addDaysToDateString(getClubNow(new Date(),"Asia/Manila").date,7);
const token=(sub:string)=>seal({sub,email:`${sub}@example.test`,name:"Test Guest",exp:Date.now()+3600000},secret);
const post=async (data:unknown,sub="guest1",origin=base)=>fetch(`${base}/api/seating-bookings`,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,Cookie:`publiq_customer_session=${token(sub)}`},body:JSON.stringify(data)});
const body=(seat="VIP 1",guests=6)=>({seat,night,time:"21:00",guests,name:"Test Guest",mobile:"09171234567",requestId:randomUUID()});
try {
 let r=await fetch(`${base}/api/seating-bookings`,{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:JSON.stringify(body())});assert.equal(r.status,401);
 r=await post(body(),"guest1","https://attacker.example");assert.equal(r.status,403);
 r=await fetch(`${base}/api/reservations`,{method:"POST"});assert.equal(r.status,410);
 r=await post(body("Couch 2"));assert.equal(r.status,400);
 r=await post(body("VIP 3 + 4"));assert.equal(r.status,400);
 r=await post(body("VIP 5",11));assert.equal(r.status,400);
 r=await post(body("VIP 1",6));assert.equal(r.status,201);let j=await r.json();assert.equal(j.booking.minimumCentavos,700000);assert.equal(j.booking.duplicate,false);
 const idempotent=body("VIP 2",9);r=await post(idempotent);assert.equal(r.status,201);j=await r.json();let ref=j.booking.reference;assert.equal(j.booking.minimumCentavos,850000);
 r=await post(idempotent);assert.equal(r.status,200);j=await r.json();assert.equal(j.booking.reference,ref);assert.equal(j.booking.duplicate,true);
 r=await post({...idempotent,guests:10});assert.equal(r.status,409);
 const same=body("VIP 3",10);const twin=body("VIP 3",10);const race=await Promise.all([post(same,"racer1"),post(twin,"racer2")]);assert.deepEqual(race.map(x=>x.status).sort(),[201,409]);
 r=await post({...body("VIP 4",10),time:"00:30"},"nightguest");assert.equal(r.status,201);j=await r.json();assert.equal(j.booking.minimumCentavos,1000000);
 const record=await db.collection("publiq_seating_bookings").findOne({reference:j.booking.reference});assert.equal(record?.status,"CONFIRMED");assert.equal(record?.startAt.toISOString(),`${night}T`+"16:30:00.000Z");assert.equal(record?.endAt.toISOString(),`${night}T`+"20:00:00.000Z");
 // Test the same unique-index + transaction mechanism used for multi-seat claims.
 const claims=db.collection("publiq_night_claims"), conflictNight=addDaysToDateString(night,1);let txn=await mongoose.startSession();
 try {await txn.withTransaction(async()=>{await claims.insertMany(seatsClaimed("VIP 3 + 4").map(seat=>({seat,night:conflictNight,reference:"COMBINED-TEST"})),{session:txn});});} finally {await txn.endSession();}
 let conflict=false;txn=await mongoose.startSession();try{await txn.withTransaction(async()=>{await claims.insertOne({seat:"VIP 4",night:conflictNight,reference:"SINGLE-TEST"},{session:txn});});}catch(e){conflict=(e as {code?:number}).code===11000;}finally{await txn.endSession();}assert.ok(conflict);
 const orphanNight=addDaysToDateString(night,2);await claims.insertOne({seat:"VIP 4",night:orphanNight,reference:"PREEXISTING"});txn=await mongoose.startSession();
 try{await txn.withTransaction(async()=>{await claims.insertMany(seatsClaimed("VIP 3 + 4").map(seat=>({seat,night:orphanNight,reference:"SHOULD-ROLLBACK"})),{session:txn,ordered:true});});}catch{}finally{await txn.endSession();}
 assert.equal(await claims.countDocuments({seat:"VIP 3",night:orphanNight}),0);
 const testEmail="owner@example.test", testPassword="Test-Passphrase-4937!";
 await db.collection("admin_users").insertOne({name:"Test Owner",email:testEmail,passwordHash:await bcrypt.hash(testPassword,10),role:"SUPER_ADMIN",isActive:true,failedLoginAttempts:0,lockedUntil:null,passwordChangedAt:new Date(),createdAt:new Date(),updatedAt:new Date()});
 // Concurrent guesses must all be counted, and the resulting lock must block
 // even a correct password. Only this disposable test account is affected.
 const lockEmail="lock-test@example.test", lockPassword="Test-Passphrase-9413!";
 await db.collection("admin_users").insertOne({name:"Lock Test",email:lockEmail,passwordHash:await bcrypt.hash(lockPassword,10),role:"STAFF",isActive:true,failedLoginAttempts:0,lockedUntil:null,passwordChangedAt:new Date(),createdAt:new Date(),updatedAt:new Date()});
 const attempts=await Promise.all(Array.from({length:5},()=>fetch(`${base}/api/auth/login`,{method:"POST",headers:{Origin:base,"Content-Type":"application/json","x-forwarded-for":"198.18.7.1"},body:JSON.stringify({email:lockEmail,password:"incorrect"})})));
 assert.ok(attempts.every(x=>x.status!==200));const locked=await db.collection("admin_users").findOne({email:lockEmail});assert.ok(locked?.lockedUntil instanceof Date && locked.lockedUntil.getTime()>Date.now());
 let lockResponse=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{Origin:base,"Content-Type":"application/json","x-forwarded-for":"198.18.7.1"},body:JSON.stringify({email:lockEmail,password:lockPassword})});assert.notEqual(lockResponse.status,200);assert.equal(await db.collection("admin_sessions").countDocuments({user:locked!._id}),0);
 const large=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({email:lockEmail,password:"x".repeat(5000)})});assert.equal(large.status,422);
 const cross=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{Origin:"https://untrusted.example","Content-Type":"application/json"},body:JSON.stringify({email:lockEmail,password:lockPassword})});assert.equal(cross.status,403);
 console.log("✓ Admin login: concurrent lockout, locked correct password denied, oversized body and cross-origin requests rejected");
 // The outdated bundled demo address is corrected without overriding a custom address.
 let contact=await fetch(`${base}/contact`);let contactHtml=await contact.text();assert.match(contactHtml,/Antipolo City, Rizal, Philippines/);assert.doesNotMatch(contactHtml,/Bacoor, Cavite/);
 let home=await fetch(`${base}/`);let homeHtml=await home.text();assert.match(homeHtml,/nightlife destination in Antipolo/);assert.doesNotMatch(homeHtml,/Bacoor, Cavite/);
 await db.collection("club_settings").updateOne({singleton:true},{$set:{address:"Custom venue address, Antipolo"}});contact=await fetch(`${base}/contact`);contactHtml=await contact.text();assert.match(contactHtml,/Custom venue address, Antipolo/);await db.collection("club_settings").updateOne({singleton:true},{$set:{address:"Level 3, The Grand Strip, Bacoor, Cavite, Philippines"}});
 console.log("✓ Location: Antipolo on home and contact, old placeholder corrected, custom address preserved");
 // If JavaScript fails to load, credentials must never fall back to a GET URL.
 {
  const browser=await chromium.launch(),context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();const requests:{method:string;url:string}[]=[];page.on("request",r=>requests.push({method:r.method(),url:r.url()}));
  await page.goto(`${base}/admin/login`);const form=page.locator('form[action="/api/auth/login"]');assert.equal(await form.getAttribute("method"),"post");assert.ok(await page.getByRole("button",{name:"Sign in",exact:true}).isDisabled());assert.match(await page.locator("main").innerText(),/Loading secure sign-in/);
  await page.locator('input[name="email"]').fill("nojs@example.test");await page.locator('input[name="password"]').fill("Fake-Only-Password123!");await page.locator('input[name="password"]').press("Enter");await page.waitForTimeout(400);assert.ok(!requests.some(r=>r.method==="GET" && (r.url.includes("Fake-Only-Password123")||r.url.includes("nojs%40example"))));await context.close();await browser.close();console.log("✓ Admin login: without JavaScript, sign-in is disabled and credentials never enter GET URLs");
 }
 // Real browser submissions always land on the dashboard, even if the login
 // URL contains a previously requested admin page. No authentication bypass.
 for (const [engine,profile,label] of [[chromium,{viewport:{width:1280,height:800}},"desktop"],[webkit,devices["iPhone SE"],"iPhone SE"]] as const) {
  const browser=await engine.launch(),context=await browser.newContext(profile),page=await context.newPage();
  await page.goto(`${base}/admin/login?next=%2Fadmin%2Fsettings`);await page.getByLabel("Email address").fill(testEmail);await page.locator('input[name="password"]').fill(testPassword);await page.getByRole("button",{name:"Sign in",exact:true}).click();await page.waitForURL(`${base}/admin`,{timeout:20000});assert.match(await page.locator("main").innerText(),/Tonight/);await context.request.post(`${base}/api/auth/logout`,{headers:{Origin:base}});await context.close();await browser.close();console.log(`✓ Admin login form: ${label} opens dashboard after successful sign-in`);
 }
 const staffBrowser=await chromium.launch(),staffContext=await staffBrowser.newContext();
 const anonymous=await staffContext.request.get(`${base}/admin/seating-bookings`);assert.match(anonymous.url(),/admin\/login/);
 const login=await staffContext.request.post(`${base}/api/auth/login`,{headers:{Origin:base},data:{email:testEmail,password:testPassword}});assert.equal(login.status(),200);
 const staffPage=await staffContext.newPage();await staffPage.goto(`${base}/admin/seating-bookings`);assert.match(await staffPage.locator("body").innerText(),/Test Guest/);assert.match(await staffPage.locator("body").innerText(),/VIP 4/);assert.match((await staffPage.locator("main").innerText()).replace(/\s+/g," "),/9:00 PM/);
 await staffPage.goto(`${base}/admin/reservations`);const website=staffPage.locator('section[aria-labelledby="website-bookings"]');assert.match(await website.innerText(),/Test Guest/);assert.match(await website.innerText(),/VIP 4/);assert.match(await website.innerText(),/10,000\.00/);assert.match(await website.innerText(),/12:30 AM/);assert.equal(await website.locator(`[data-website-booking="${ref}"]`).count(),1);
 // The seating section is independent of legacy filters and has no 200-record cutoff.
 await staffPage.goto(`${base}/admin/reservations?view=all&q=does-not-match`);assert.equal(await staffPage.locator(`[data-website-booking="${ref}"]`).count(),1);
 const seed=Array.from({length:26},(_,i)=>({reference:`PAGINATION-${i}`,googleSub:`pagination-${i}`,requestId:`pagination-${i}`,seat:"VIP 1",night,time:"21:00",guests:2,minimumCentavos:0,status:"CONFIRMED",name:"Pagination Guest",mobile:"09171234567",googleEmail:"test@example.test",createdAt:new Date(Date.now()+i*1000)}));await db.collection("publiq_seating_bookings").insertMany(seed);
 await staffPage.goto(`${base}/admin/reservations`);assert.equal(await staffPage.locator('[data-website-booking]').count(),25);await staffPage.getByRole('link',{name:'Next page'}).first().click();await staffPage.waitForURL(/websitePage=2/);await staffPage.locator(`[data-website-booking="${ref}"]`).waitFor();assert.equal(await staffPage.locator(`[data-website-booking="${ref}"]`).count(),1);await db.collection("publiq_seating_bookings").deleteMany({reference:{$regex:"^PAGINATION-"}});
 await staffPage.setViewportSize({width:375,height:667});await staffPage.goto(`${base}/admin/reservations`);assert.equal(await staffPage.locator(`[data-website-booking="${ref}"]`).count(),1);assert.ok(await staffPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 console.log("✓ Reservations page: website bookings visible, price and time correct, independent filters, pagination, mobile layout");
 // Mobile admin chrome remains usable after the visual refresh.
 await staffPage.goto(`${base}/admin/reservations`);await staffPage.getByRole("button",{name:"Open navigation menu"}).click();assert.equal(await staffPage.getByRole("navigation",{name:"Admin sections"}).getByRole("link",{name:"Reservations",exact:true}).count(),1);await staffPage.getByRole("navigation",{name:"Admin sections"}).getByRole("link",{name:"Dashboard",exact:true}).click();await staffPage.waitForURL(`${base}/admin`);assert.match(await staffPage.locator("main").innerText(),/Dashboard figures below cover front-desk reservations only/);assert.ok(await staffPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 console.log("✓ Mobile admin: menu opens, dashboard navigation works, booking totals limitation is visible");
 await staffPage.goto(`${base}/admin/settings`);assert.equal(await staffPage.locator("#set-open").inputValue(),"21:00");assert.match((await staffPage.locator("#set-open option:checked").innerText()).replace(/\s+/g," "),/9:00 PM/);assert.equal(await staffPage.locator("#set-close").inputValue(),"04:00");assert.match((await staffPage.locator("#set-close option:checked").innerText()).replace(/\s+/g," "),/4:00 AM/);await staffPage.locator("#set-open").selectOption("21:15");assert.match((await staffPage.locator("#set-open option:checked").innerText()).replace(/\s+/g," "),/9:15 PM/);
 await staffContext.request.post(`${base}/api/auth/logout`,{headers:{Origin:base}});await staffContext.close();await staffBrowser.close();
 console.log("✓ Staff seating-booking list requires admin sign-in and displays confirmed bookings");
 console.log("✓ API: authentication, origin, legacy shutdown, capacity gating, pricing, confirmation, idempotency, concurrency, overnight times");
 console.log("✓ Combined physical-seat claims: both-space blocking and rollback tested in disposable DB (combined booking itself remains disabled)");
 for(const [engine,name,device] of [[webkit,"iPhone SE",devices["iPhone SE"]],[chromium,"Pixel 5",devices["Pixel 5"]]] as const){
  const browser=await engine.launch(),context=await browser.newContext(device);await context.addCookies([{name:"publiq_customer_session",value:token(`ui-${name.replace(/\s/g,"")}`),url:base,httpOnly:true,sameSite:"Lax"}]);const page=await context.newPage();
  await page.goto(`${base}/reserve?seat=VIP%207`);assert.equal(await page.locator('select').first().inputValue(),"VIP 7");assert.equal(await page.getByLabel('Arrival time').inputValue(),'21:00');assert.match((await page.getByLabel('Arrival time').locator('option:checked').innerText()).replace(/\s+/g,' '),/9:00 PM/);
  await page.getByLabel('Night of visit').fill(addDaysToDateString(night,name==="iPhone SE"?3:4));await page.getByLabel('Number of guests').fill('9');await page.getByLabel('Mobile number').fill('09171234567');
  await page.getByRole('button',{name:'Confirm reservation'}).tap();try { await page.getByRole('heading',{name:'Reservation confirmed'}).waitFor({timeout:20000}); } catch(e) { console.error('Form state:', await page.locator('main').innerText()); await context.close(); await browser.close(); throw e; }
  assert.match(await page.locator('body').innerText(),/₱8,500/);assert.match((await page.locator('main').innerText()).replace(/\s+/g,' '),/9:00 PM/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto(`${base}/my-seating-bookings`);assert.match(await page.locator("main").innerText(),/VIP 7/);assert.match((await page.locator("main").innerText()).replace(/\s+/g," "),/9:00 PM/);assert.doesNotMatch(await page.locator("main").innerText(),/VIP 1/);
  await context.close();await browser.close();console.log(`✓ ${name} emulation: completed booking form and confirmed result`);
 }
} finally {await mongoose.connection.dropDatabase();await mongoose.disconnect();console.log(`Deleted isolated test DB ${dbName}`);}

}
main().catch(error => { console.error(error); process.exitCode=1; });
