import { NextResponse } from "next/server";
/** Legacy unauthenticated hourly room booking is retired. */
export async function POST() { return NextResponse.json({error:"This legacy booking endpoint is no longer available."},{status:410,headers:{"Cache-Control":"no-store"}}); }
