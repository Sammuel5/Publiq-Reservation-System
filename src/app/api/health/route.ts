import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/db/mongoose";

/**
 * GET /api/health — public liveness/readiness probe.
 * Exposes no configuration, credentials, hostnames or table data.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await checkDatabaseHealth();

  return NextResponse.json(
    {
      status: db.connected ? "ok" : "degraded",
      service: "ktv-reservation-system",
      phase: 1,
      database: {
        connected: db.connected,
        latencyMs: db.latencyMs ?? null,
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: db.connected ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
