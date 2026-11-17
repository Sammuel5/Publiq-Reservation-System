import { NextResponse, type NextRequest } from "next/server";
import { readSessionCookie } from "@/lib/auth/cookies";
import { logoutAdmin } from "@/lib/services/admin-auth";
import { isSameOriginRequest } from "@/lib/http";
import { ForbiddenError, toErrorResponse } from "@/lib/errors";

/**
 * POST /api/auth/logout
 * Revokes the server-side session, then clears the cookie. Safe to call even
 * when the session is already invalid.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      throw new ForbiddenError("Cross-origin requests are not allowed.");
    }

    const token = await readSessionCookie();
    await logoutAdmin(token);

    return NextResponse.json(
      { ok: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, "api.auth.logout");
  }
}
