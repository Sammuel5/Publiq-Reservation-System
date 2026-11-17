import { NextResponse, type NextRequest } from "next/server";
import { getClubSettings } from "@/lib/services/club-settings";
import {
  MAX_ADVANCE_DAYS,
  MIN_LEAD_MINUTES,
  computeDaySlots,
  computeRoomAvailability,
  loadAvailabilityContext,
} from "@/lib/services/availability";
import { availabilityQuerySchema } from "@/lib/validation/reservation";
import { enforceRateLimit } from "@/lib/rate-limit";
import { rateLimitSubject } from "@/lib/http";
import { toErrorResponse } from "@/lib/errors";
import { getClubNow } from "@/lib/utils/datetime";

/**
 * GET /api/availability?date=YYYY-MM-DD[&duration=120][&startTime=19:00][&guests=4]
 *
 * Public, read-only availability feed for the booking wizard.
 * - `slots`   start times on the 30-minute grid with how many rooms are free.
 * - `rooms`   per-room availability for `startTime` (when supplied).
 *
 * Nothing sensitive is returned: no customer data, no reservation ids.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await enforceRateLimit({
      key: `availability:${rateLimitSubject(request.headers)}`,
      limit: 120,
      windowMs: 5 * 60_000,
    });

    const url = new URL(request.url);
    const parsed = availabilityQuerySchema.parse({
      date: url.searchParams.get("date") ?? undefined,
      duration: url.searchParams.get("duration") ?? undefined,
      startTime: url.searchParams.get("startTime") ?? undefined,
      guests: url.searchParams.get("guests") ?? undefined,
    });

    const settings = await getClubSettings();
    const duration = parsed.duration ?? settings.defaultDuration;
    const context = await loadAvailabilityContext(settings, parsed.date);

    const { slots, closed, reason } = computeDaySlots(context, duration);

    const rooms =
      parsed.startTime !== undefined
        ? computeRoomAvailability(context, parsed.startTime, duration, parsed.guests).map(
            (entry) => ({
              slug: entry.room.slug,
              name: entry.room.name,
              categorySlug: entry.room.categorySlug,
              capacity: entry.room.capacity,
              hourlyRate: entry.room.hourlyRate,
              estimatedAmount: entry.estimatedAmount,
              minimumDuration: entry.room.minimumDuration,
              image: entry.room.coverImage ?? entry.room.images[0] ?? null,
              amenities: entry.room.amenities,
              available: entry.available,
              code: entry.code,
              message: entry.message,
            }),
          )
        : [];

    return NextResponse.json(
      {
        date: parsed.date,
        duration,
        now: getClubNow(new Date(), settings.timezone),
        operating: {
          isOpen: context.window.isOpen,
          openingTime: context.window.openingTime,
          closingTime: context.window.closingTime,
          closed,
          reason,
        },
        slots: slots,
        rooms,
        limits: {
          minLeadMinutes: MIN_LEAD_MINUTES,
          maxAdvanceDays: MAX_ADVANCE_DAYS,
          minimumDuration: settings.minimumDuration,
          defaultDuration: settings.defaultDuration,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, "api.availability");
  }
}
