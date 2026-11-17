import { z } from "zod";
import { addDaysToDateString, clubDateTimeToUtc, getClubNow, getClubWeekday, isDateString } from "@/lib/utils/datetime";
import { vipConsumableMinimum } from "@/lib/utils/publiq-vip-policy";

// Unknown capacities deliberately stay unavailable until confirmed by the owner.
export const SEATS = ["VIP 1","VIP 2","VIP 3","VIP 4","VIP 5","VIP 6","VIP 7","VIP 3 + 4","Couch 2","Couch 3","Couch 4","Couch 5","Couch 6"] as const;
export type Seat = typeof SEATS[number];
export const LIMITS: Record<Seat, number | null> = {"VIP 1":12,"VIP 2":12,"VIP 3":12,"VIP 4":12,"VIP 5":10,"VIP 6":10,"VIP 7":12,"VIP 3 + 4":null,"Couch 2":null,"Couch 3":null,"Couch 4":null,"Couch 5":null,"Couch 6":null};
export const bookingSchema=z.object({ seat:z.enum(SEATS), night:z.string().refine(isDateString,"Choose a valid date."), time:z.string().regex(/^(?:2[1-3]|0[0-3]):(?:00|30)$/,"Choose an arrival time between 9 PM and 3:30 AM."), guests:z.number().int().min(1).max(100), name:z.string().trim().min(2).max(100), mobile:z.string().trim().regex(/^\+?[0-9 ()-]{7,25}$/).refine(v => v.replace(/\D/g, "").length >= 7 && v.replace(/\D/g, "").length <= 15, "Enter a valid mobile number."), requestId:z.string().uuid() }).strict();
export type BookingInput=z.infer<typeof bookingSchema>;
export function seatsClaimed(seat: Seat): string[] {return seat === "VIP 3 + 4" ? ["VIP 3","VIP 4"] : [seat];}
export function validateBooking(input: BookingInput, settings: {timezone:string;openingTime:string;closingTime:string;operatingDays:number[]}, now=new Date()) {
  const capacity=LIMITS[input.seat]; if (capacity===null) throw new Error("This space is not available online until its capacity is confirmed.");
  if (input.guests>capacity) throw new Error(`This space fits up to ${capacity} guests.`);
  if (settings.openingTime!=="21:00" || settings.closingTime!=="04:00") throw new Error("Booking hours need staff configuration before online reservations can open.");
  const today=getClubNow(now,settings.timezone).date;
  const earliest=addDaysToDateString(today,-1), latest=addDaysToDateString(today,60);
  if (input.night<earliest || input.night>latest) throw new Error("Choose a date within the next 60 days.");
  const startDate=input.time<"04:00"?addDaysToDateString(input.night,1):input.night;
  const start=clubDateTimeToUtc(startDate,input.time,settings.timezone), end=clubDateTimeToUtc(addDaysToDateString(input.night,1),"04:00",settings.timezone);
  if (start.getTime() < now.getTime()+30*60000 || start>=end) throw new Error("Please choose an arrival at least 30 minutes from now.");
  const opens=clubDateTimeToUtc(input.night,"21:00",settings.timezone);
  if (!settings.operatingDays.includes(getClubWeekday(opens,settings.timezone))) throw new Error("The venue is closed on that night.");
  return { start,end, minimumCentavos:input.seat.startsWith("VIP")?vipConsumableMinimum(input.guests):0 };
}
