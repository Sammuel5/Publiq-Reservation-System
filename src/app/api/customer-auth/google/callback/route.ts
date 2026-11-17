import { NextRequest, NextResponse } from "next/server";
import { customerGoogleConfig } from "@/lib/customer-auth/config";
import { equalTokens, seal, unseal, validSeat } from "@/lib/customer-auth/crypto";
import { CUSTOMER_COOKIE, GOOGLE_FLOW_COOKIE } from "@/lib/customer-auth/session";

export const dynamic = "force-dynamic";
type Flow = { state: string; nonce: string; verifier: string; seat: string; exp: number };
export async function GET(request: NextRequest) {
  const config = customerGoogleConfig();
  if (!config) return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const origin = new URL(config.redirectUri).origin;
  const fail = () => { const response = NextResponse.redirect(new URL("/reserve?auth=failed", origin), { headers: { "Cache-Control": "no-store" } }); response.cookies.set(GOOGLE_FLOW_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: config.secure, path: "/api/customer-auth/google", maxAge: 0 }); return response; };
  const value = request.cookies.get(GOOGLE_FLOW_COOKIE)?.value;
  const flow = value ? unseal<Flow>(value, config.sessionSecret) : null;
  const state = request.nextUrl.searchParams.get("state"), code = request.nextUrl.searchParams.get("code");
  if (!flow || typeof flow.state !== "string" || typeof flow.nonce !== "string" || typeof flow.verifier !== "string" || !Number.isSafeInteger(flow.exp) || flow.exp <= Date.now() || !state || !code || !equalTokens(flow.state, state)) return fail();
  try {
    const { tokens } = await config.oauth.getToken({ code, codeVerifier: flow.verifier, redirect_uri: config.redirectUri });
    if (!tokens.id_token) return fail();
    const ticket = await config.oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
    const identity = ticket.getPayload();
    if (!identity || !identity.sub || !identity.email || identity.email_verified !== true || typeof identity.nonce !== "string" || !equalTokens(identity.nonce, flow.nonce)) return fail();
    const seat = typeof flow.seat === "string" && validSeat(flow.seat) ? flow.seat : "";
    const destination = new URL("/reserve", origin); if (seat) destination.searchParams.set("seat", seat);
    const response = NextResponse.redirect(destination, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(CUSTOMER_COOKIE, seal({ sub: identity.sub, email: identity.email, name: identity.name ?? "Guest", exp: Date.now() + 8 * 60 * 60_000 }, config.sessionSecret), { httpOnly: true, secure: config.secure, sameSite: "lax", path: "/", maxAge: 8 * 60 * 60 });
    response.cookies.set(GOOGLE_FLOW_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: config.secure, path: "/api/customer-auth/google", maxAge: 0 });
    return response;
  } catch { return fail(); }
}
