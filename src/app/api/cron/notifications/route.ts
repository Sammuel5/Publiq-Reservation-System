import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/api/cron";
import { processSeatingEmails } from "@/lib/services/publiq-bookings/email-notifications";
import { toErrorResponse } from "@/lib/errors";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const seating = await processSeatingEmails();
    // The legacy reservation workflow is retired; do not deliver its old jobs.
    return NextResponse.json({ seating }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error, "cron.notifications"); }
}
