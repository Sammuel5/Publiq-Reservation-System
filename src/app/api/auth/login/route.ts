import { NextResponse, type NextRequest } from "next/server";
import { loginSchema } from "@/lib/validation/auth";
import { loginAdmin } from "@/lib/services/admin-auth";
import { enforceRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { rateLimitSubject, isSameOriginRequest } from "@/lib/http";
import { ForbiddenError, LoginRateLimitError, RateLimitError, toErrorResponse, ValidationError } from "@/lib/errors";
import { getMaskedClientIp } from "@/lib/http";

/**
 * POST /api/auth/login
 *
 * Defenses applied here:
 * - same-origin check (CSRF defense in depth)
 * - Zod validation of the payload
 * - rate limiting per IP and per submitted email
 * - generic error message that never reveals whether an account exists
 * - account lockout after repeated failures (in the service layer)
 * - session token delivered only as an httpOnly cookie
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      throw new ForbiddenError("Cross-origin login attempts are not allowed.");
    }

    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") ?? "")) {
      throw new ValidationError("Expected a JSON request body.");
    }
    // Limit the stream itself, not only Content-Length (which can be omitted or lied about).
    const reader = request.body?.getReader();
    if (!reader) throw new ValidationError("Expected a JSON request body.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new ValidationError("Login request is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new ValidationError("Expected a JSON request body."); }

    const { email, password } = loginSchema.parse(raw);

    const subject = rateLimitSubject(request.headers);
    // Tell the browser which quota was hit without changing the limits. A
    // network limit applies to every account on that IP; an email quota does not.
    for (const [scope, key, limit] of [
      ["ip", `login:ip:${subject}`, 10],
      ["email", `login:email:${email}`, 8],
    ] as const) {
      try {
        await enforceRateLimit({ key, limit, windowMs: 15 * 60_000 });
      } catch (error) {
        if (error instanceof RateLimitError) throw new LoginRateLimitError(error.retryAfterSeconds, scope);
        throw error;
      }
    }

    const { user, expiresAt } = await loginAdmin(email, password, {
      userAgent: request.headers.get("user-agent"),
      ipHint: getMaskedClientIp(request.headers),
    });

    await resetRateLimit(`login:email:${email}`);

    return NextResponse.json(
      { user, expiresAt: expiresAt.toISOString() },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return toErrorResponse(error, "api.auth.login");
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST to sign in." } },
    { status: 405, headers: { Allow: "POST" } },
  );
}
