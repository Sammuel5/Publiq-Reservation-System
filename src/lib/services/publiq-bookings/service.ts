import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import type { CustomerSession } from "@/lib/customer-auth/session";
import { getClubSettings } from "@/lib/services/club-settings";
import { type BookingInput, seatsClaimed, validateBooking } from "./policy";
import { seatingEmailJobs, type SeatingEmail } from "./email-notifications";

export class BookingConflict extends Error {}
export class RequestConflict extends Error {}
function digest(input: BookingInput) {return createHash("sha256").update(JSON.stringify([input.seat,input.night,input.time,input.guests,input.name,input.mobile])).digest("hex");}
/** One unique claim per physical space and business night; transaction prevents partial combined claims. */
export async function createSeatingBooking(input: BookingInput, customer: CustomerSession) {
 await connectToDatabase();const db=mongoose.connection.db!;const reservations=db.collection("publiq_seating_bookings"), claims=db.collection("publiq_night_claims");
 await Promise.all([reservations.createIndex({googleSub:1,requestId:1},{unique:true,name:"unique_customer_request"}),reservations.createIndex({reference:1},{unique:true,name:"unique_booking_reference"}),claims.createIndex({seat:1,night:1},{unique:true,name:"unique_seat_night"}),db.collection<SeatingEmail>("publiq_email_outbox").createIndex({kind:1,state:1,nextAttemptAt:1,createdAt:1},{name:"seating_email_due"})]);
 const fingerprint=digest(input);
 const lookup=async()=>{const existing=await reservations.findOne({googleSub:customer.sub,requestId:input.requestId});if(!existing)return null;if(existing.fingerprint!==fingerprint)throw new RequestConflict("This request was already used for different booking details.");if(existing.status!=="CONFIRMED")throw new RequestConflict("This reservation is no longer confirmed. Start a new booking request.");return {reference:existing.reference as string,seat:existing.seat as string,night:existing.night as string,time:existing.time as string,guests:existing.guests as number,minimumCentavos:existing.minimumCentavos as number,duplicate:true};};
 const prior=await lookup();if(prior)return prior;
 const settings=await getClubSettings();const values=validateBooking(input,settings);
 const reference=`PUB-${randomBytes(8).toString("hex").toUpperCase()}`;
 const session=await mongoose.startSession();
 try {
  await session.withTransaction(async()=>{
   await claims.insertMany(seatsClaimed(input.seat).map(seat=>({seat,night:input.night,reference})),{session,ordered:true});
   await reservations.insertOne({reference,googleSub:customer.sub,googleEmail:customer.email,requestId:input.requestId,fingerprint,seat:input.seat,night:input.night,time:input.time,guests:input.guests,name:input.name,mobile:input.mobile,minimumCentavos:values.minimumCentavos,startAt:values.start,endAt:values.end,status:"CONFIRMED",createdAt:new Date()}, {session});
   await db.collection<SeatingEmail>("publiq_email_outbox").insertMany(seatingEmailJobs({reference,email:customer.email,seat:input.seat,night:input.night,time:input.time,guests:input.guests,minimumCentavos:values.minimumCentavos}), {session});
  });
  return {reference,seat:input.seat,night:input.night,time:input.time,guests:input.guests,minimumCentavos:values.minimumCentavos,duplicate:false};
 } catch(error) {
  if ((error as {code?:number})?.code===11000) {const existing=await lookup();if(existing)return existing;throw new BookingConflict("This space is already booked for that night.");}
  throw error;
 } finally {await session.endSession();}
}
