import { authorizeCron } from "@/lib/api/cron";
import { NextResponse, type NextRequest } from "next/server";
import { sweepExpiredPending } from "@/lib/services/admin/reservations";
import { toErrorResponse } from "@/lib/errors";

/** Scheduler-only endpoint. Configure CRON_SECRET and send Bearer authentication. */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const result = await sweepExpiredPending();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error, "cron.expire-holds");
  }
}
