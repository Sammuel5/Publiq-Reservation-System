import { randomBytes, createHash } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";
import { customerGoogleConfig } from "@/lib/customer-auth/config";
import { seal, validSeat } from "@/lib/customer-auth/crypto";
import { GOOGLE_FLOW_COOKIE } from "@/lib/customer-auth/session";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const config = customerGoogleConfig();
  if (!config) return NextResponse.json({ error: "Google sign-in is not configured." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const raw = request.nextUrl.searchParams.get("seat") ?? "";
  const seat = validSeat(raw) ? raw : "";
  const state = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = config.oauth.generateAuthUrl({ access_type: "online", scope: ["openid", "email", "profile"], state, nonce, code_challenge_method: CodeChallengeMethod.S256, code_challenge: challenge });
  const response = NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(GOOGLE_FLOW_COOKIE, seal({ state, nonce, verifier, seat, exp: Date.now() + 10 * 60_000 }, config.sessionSecret), { httpOnly: true, secure: config.secure, sameSite: "lax", path: "/api/customer-auth/google", maxAge: 600 });
  return response;
}
