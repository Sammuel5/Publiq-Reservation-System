import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ error: { code: "LEGACY_DISABLED", message: "Old availability is no longer available." } }, { status: 410, headers: { "Cache-Control": "no-store" } }); }
