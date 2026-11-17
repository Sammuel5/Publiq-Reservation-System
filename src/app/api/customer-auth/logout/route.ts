import { NextRequest, NextResponse } from "next/server";
import { customerGoogleConfig } from "@/lib/customer-auth/config";
import { CUSTOMER_COOKIE } from "@/lib/customer-auth/session";
export async function POST(request: NextRequest) {
  const config = customerGoogleConfig();
  if (!config || request.headers.get("origin") !== new URL(config.redirectUri).origin) return NextResponse.json({error:"Invalid request"},{status:403});
  const response = NextResponse.redirect(new URL('/reserve', config.redirectUri), {status:303,headers:{"Cache-Control":"no-store"}});
  response.cookies.set(CUSTOMER_COOKIE, '', {httpOnly:true, secure:config.secure, sameSite:'lax', path:'/', maxAge:0});
  return response;
}
