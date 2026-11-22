/** No live provider calls. Uses a disposable MongoDB replica-set database only. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { cancelSeatingBooking } from "../src/lib/services/publiq-bookings/cancellation";
import { connectToDatabase, disconnectFromDatabase } from "../src/lib/db/mongoose";
import { createSeatingBooking, BookingConflict } from "../src/lib/services/publiq-bookings/service";
import { processSeatingEmails, classifyMailFailure } from "../src/lib/services/publiq-bookings/email-notifications";
import { addDaysToDateString, getClubNow } from "../src/lib/utils/datetime";

async function main() {
 const name=process.env.MONGODB_DB_NAME??"";
 if(!/^publiq_booking_test_[a-f0-9]{12}$/.test(name)) throw new Error("Refusing to run outside disposable database");
 const db=(await connectToDatabase()).connection.db!;
 const requests:{from:string;to:string;key:string;text:string}[]=[]; let fail=false;
 const send=async (message:{from:string;to:string;subject:string;text:string;messageId:string})=>{requests.push({from:message.from,to:message.to,key:message.messageId,text:message.text});if(fail)throw Object.assign(new Error("secret or address must not appear"),{code:"EAUTH",responseCode:535});};
 try {
  await db.collection("club_settings").insertOne({singleton:true,clubName:"Test",openingTime:"21:00",closingTime:"04:00",timezone:"Asia/Manila",operatingDays:[0,1,2,3,4,5,6]});
  const night=addDaysToDateString(getClubNow(new Date(),"Asia/Manila").date,5);
  const input={seat:"VIP 1" as const,night,time:"00:30",guests:6,name:"Test Guest",mobile:"09171234567",requestId:randomUUID()};
  const customer={sub:"test-sub",email:"guest@example.test",name:"Test Guest",exp:Date.now()+3600000};
  const booking=await createSeatingBooking(input,customer);
  assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:booking.reference}),2);
  assert.equal((await createSeatingBooking(input,customer)).duplicate,true);
  assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:booking.reference}),2);
  await assert.rejects(()=>createSeatingBooking({...input,requestId:randomUUID()},{...customer,sub:"other"}),BookingConflict);
  assert.equal(await db.collection("publiq_email_outbox").countDocuments(),2);
  delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD;delete process.env.NOTIFICATION_STAFF_EMAIL;
  assert.equal((await processSeatingEmails(10,send)).configured,false);assert.equal(requests.length,0);
  process.env.GMAIL_USER="sender@gmail.com";process.env.GMAIL_APP_PASSWORD="fake-test-password";
  await Promise.all([processSeatingEmails(10,send),processSeatingEmails(10,send)]);
  assert.equal(requests.length,1);assert.equal(requests[0]?.to,"guest@example.test");assert.match(requests[0]!.text,/12:30 AM \(following day\)/);assert.match(requests[0]!.text,/7,000/);
  assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:booking.reference,state:"pending",kind:"staff"}),1);
  process.env.NOTIFICATION_STAFF_EMAIL="staff@example.test";await Promise.all([processSeatingEmails(10,send),processSeatingEmails(10,send)]);
  assert.equal(requests.length,2);assert.equal(requests[1]?.to,"staff@example.test");assert.ok(requests.every(r=>r.from==="PUBLIQ <sender@gmail.com>" && r.key));assert.equal(new Set(requests.map(r=>r.key)).size,2);
  assert.equal(await db.collection("publiq_email_outbox").countDocuments({state:"sent"}),2);
  const second=await createSeatingBooking({...input,seat:"VIP 2",requestId:randomUUID()},{...customer,sub:"second"});fail=true;
  const result=await processSeatingEmails(1,send);assert.equal(result.failed,1);assert.deepEqual(result.failureReasons,{authentication:1});assert.equal(classifyMailFailure({code:"ETIMEDOUT"}),"connection");assert.equal(classifyMailFailure({responseCode:550}),"rejected");assert.equal(classifyMailFailure({responseCode:421}),"temporary_rejection");assert.equal(classifyMailFailure({code:"untrusted secret"}),"unknown");assert.doesNotMatch(JSON.stringify(result),/secret|address/);
  const failed=await db.collection("publiq_email_outbox").findOne({reference:second.reference,state:"pending",attempts:1});assert.ok(failed);assert.ok(failed.nextAttemptAt > new Date());
  const priorKey=requests[2]?.key;await db.collection("publiq_email_outbox").updateOne({_id:failed._id},{$set:{nextAttemptAt:new Date(0)}});fail=false;await processSeatingEmails(1,send);assert.equal(requests[3]?.key,priorKey);
  await db.collection("publiq_seating_bookings").updateOne({reference:second.reference},{$set:{status:"CANCELLED"}});const before=requests.length;await processSeatingEmails(10,send);assert.equal(requests.length,before);assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:second.reference,state:"skipped"}),1);
  const third=await createSeatingBooking({...input,seat:"VIP 3",requestId:randomUUID()},{...customer,sub:"third",email:"third@example.test"});
  const doc3=await db.collection("publiq_seating_bookings").findOne({reference:third.reference});assert.ok(doc3);
  await cancelSeatingBooking(String(doc3._id),String(new Types.ObjectId()));const beforeCancel=requests.length;
  await Promise.all([processSeatingEmails(10,send),processSeatingEmails(10,send)]);
  const cancelSends=requests.slice(beforeCancel);assert.equal(cancelSends.length,1);assert.equal(cancelSends[0]?.to,"third@example.test");assert.match(cancelSends[0]!.text,/has been cancelled/);assert.doesNotMatch(cancelSends[0]!.text,/is confirmed|held until/);
  assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:third.reference,state:"skipped"}),2);assert.equal(await db.collection("publiq_email_outbox").countDocuments({reference:third.reference,kind:"cancelled",state:"sent"}),1);
  console.log("✓ Cancellation email reaches only guest in simulated delivery; stale confirmations skipped");
  console.log("✓ Transactional email outbox: duplicate booking, conflicts, missing config, staff gate, concurrent workers, retry and obsolete messages");
  console.log("✓ Simulated Gmail transport: one guest email and one staff email, stable message IDs, PHP amount and overnight arrival; no SMS or live network calls");
 } finally {await db.dropDatabase();await disconnectFromDatabase();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
