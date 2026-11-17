import { NextResponse, type NextRequest } from "next/server";
import { authorizeCron } from "@/lib/api/cron";
import { processNotifications } from "@/lib/services/notifications";
import { toErrorResponse } from "@/lib/errors";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    return NextResponse.json(await processNotifications(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return toErrorResponse(error, "cron.notifications"); }
}
