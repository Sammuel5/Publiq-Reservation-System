import { NextResponse, type NextRequest } from "next/server";
import { cancellationSchema } from "@/lib/validation/reservation";
import { requestCancellation } from "@/lib/services/reservations";
import { getClubSettings } from "@/lib/services/club-settings";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest, rateLimitSubject } from "@/lib/http";
import { ForbiddenError, ValidationError, toErrorResponse } from "@/lib/errors";
import { normalizeMobileNumber } from "@/lib/utils/normalize";

/**
 * POST /api/reservations/cancel
 *
 * Customers may only ever request a cancellation for their own reservation.
 * The club's policy is enforced server-side: outside the cutoff window the
 * booking is cancelled immediately; inside it, the request is queued for staff
 * approval and the reservation keeps its current status.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      throw new ForbiddenError("Cross-origin requests are not allowed.");
    }

    const raw = await request.json().catch(() => {
      throw new ValidationError("Expected a JSON request body.");
    });
    const input = cancellationSchema.parse(raw);

    await enforceRateLimit({
      key: `cancel:ip:${rateLimitSubject(request.headers)}`,
      limit: 10,
      windowMs: 60 * 60_000,
    });
    const mobile = normalizeMobileNumber(input.mobileNumber);
    if (mobile) {
      await enforceRateLimit({ key: `cancel:mobile:${mobile}`, limit: 6, windowMs: 60 * 60_000 });
    }

    const settings = await getClubSettings();
    const result = await requestCancellation({
      reference: input.reference,
      mobileNumber: input.mobileNumber,
      reason: input.reason,
      settings,
    });

    return NextResponse.json(
      { mode: result.mode, message: result.message, reservation: result.reservation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, "api.reservations.cancel");
  }
}
