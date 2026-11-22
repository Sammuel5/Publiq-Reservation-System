import { NextResponse } from "next/server";
export async function POST() { return NextResponse.json({ error: { code: "LEGACY_DISABLED", message: "The old booking system is disabled." } }, { status: 410, headers: { "Cache-Control": "no-store" } }); }
