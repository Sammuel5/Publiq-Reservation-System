import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { customerGoogleConfig } from "@/lib/customer-auth/config";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { bookingSchema } from "@/lib/services/publiq-bookings/policy";
import { BookingConflict, RequestConflict, createSeatingBooking } from "@/lib/services/publiq-bookings/service";
import { enforceRateLimit } from "@/lib/rate-limit";
import { toErrorResponse } from "@/lib/errors";
export const dynamic="force-dynamic";
const noStore={"Cache-Control":"no-store"};
export async function POST(request:NextRequest) {
 const config=customerGoogleConfig();
 if(process.env.CUSTOMER_BOOKINGS_ENABLED!=="true" || !config) return NextResponse.json({error:"Online booking is not enabled."},{status:503,headers:noStore});
 if(request.headers.get("origin")!==new URL(config.redirectUri).origin) return NextResponse.json({error:"Invalid request origin."},{status:403,headers:noStore});
 const customer=await getCustomerSession();if(!customer)return NextResponse.json({error:"Sign in with Google first."},{status:401,headers:noStore});
 try {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({error:"Expected JSON."},{status:415,headers:noStore});
  const text=await request.text();if(text.length>4096)return NextResponse.json({error:"Request too large."},{status:413,headers:noStore});
  let data:unknown;try {data=JSON.parse(text);}catch{return NextResponse.json({error:"Invalid JSON."},{status:400,headers:noStore});}
  const input=bookingSchema.parse(data);
  await enforceRateLimit({key:`publiq-booking:user:${customer.sub}`,limit:20,windowMs:60*60_000});
  const result=await createSeatingBooking(input,customer);
  return NextResponse.json({booking:result},{status:result.duplicate?200:201,headers:noStore});
 } catch(error) {
  if(error instanceof ZodError)return NextResponse.json({error:error.issues[0]?.message??"Invalid booking details."},{status:400,headers:noStore});
  if(error instanceof BookingConflict || error instanceof RequestConflict)return NextResponse.json({error:error.message},{status:409,headers:noStore});
  if(error instanceof Error && /^(This space|Booking hours|Choose a date|Please choose|The venue)/.test(error.message))return NextResponse.json({error:error.message},{status:400,headers:noStore});
  return toErrorResponse(error,"api.seating-bookings");
 }
}
