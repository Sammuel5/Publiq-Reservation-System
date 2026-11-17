import { NextResponse, type NextRequest } from "next/server";
import { lookupSchema } from "@/lib/validation/reservation";
import { lookupReservation } from "@/lib/services/reservations";
import { getClubSettings } from "@/lib/services/club-settings";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest, rateLimitSubject } from "@/lib/http";
import { ForbiddenError, ValidationError, toErrorResponse } from "@/lib/errors";
import { normalizeMobileNumber } from "@/lib/utils/normalize";

/**
 * POST /api/reservations/lookup
 *
 * Reference + mobile number are BOTH required, and a mismatch returns the same
 * error as an unknown reference, so neither can be enumerated. Only the
 * requesting customer's own reservation is ever returned, with the mobile number
 * masked.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginRequest(request)) {
      throw new ForbiddenError("Cross-origin requests are not allowed.");
    }

    const raw = await request.json().catch(() => {
      throw new ValidationError("Expected a JSON request body.");
    });
    const input = lookupSchema.parse(raw);

    await enforceRateLimit({
      key: `lookup:ip:${rateLimitSubject(request.headers)}`,
      limit: 20,
      windowMs: 15 * 60_000,
    });

    const mobile = normalizeMobileNumber(input.mobileNumber);
    if (mobile) {
      await enforceRateLimit({ key: `lookup:mobile:${mobile}`, limit: 15, windowMs: 15 * 60_000 });
    }

    const settings = await getClubSettings();
    const reservation = await lookupReservation({
      reference: input.reference,
      mobileNumber: input.mobileNumber,
      settings,
    });

    return NextResponse.json(
      { reservation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, "api.reservations.lookup");
  }
}
