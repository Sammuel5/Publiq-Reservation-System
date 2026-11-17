import { NextResponse } from "next/server";
import { getCurrentAdmin } from "@/lib/auth/guards";
import { ROLE_PERMISSIONS } from "@/config/app";
import { UnauthorizedError, toErrorResponse } from "@/lib/errors";

/**
 * GET /api/auth/session
 * Returns the authenticated admin (never a password hash) plus the permission
 * keys their role grants, so client UI can hide actions it must not offer.
 * Server-side guards remain authoritative.
 */
export async function GET() {
  try {
    const session = await getCurrentAdmin();
    if (!session) throw new UnauthorizedError();

    return NextResponse.json(
      {
        user: session.user,
        permissions: ROLE_PERMISSIONS[session.user.role] ?? [],
        expiresAt: session.expiresAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, "api.auth.session");
  }
}
