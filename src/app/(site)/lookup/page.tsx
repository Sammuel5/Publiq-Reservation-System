import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, KeyRound } from "lucide-react";
import { getClubSettings } from "@/lib/services/club-settings";
import { LookupPanel } from "@/components/site/lookup-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check my reservation",
  description:
    "Look up a KTV reservation with your reference number and mobile number, and request a cancellation.",
};

export default async function LookupPage() {
  const settings = await getClubSettings();

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
          {settings.clubName}
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight sm:text-5xl">
          Check your reservation
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          No account needed. Enter your reference number and the mobile number you booked
          with to see the current status.
        </p>
      </header>

      <div className="mt-8">
        <LookupPanel
          cancellationPolicy={settings.cancellationPolicy}
          contactNumber={settings.contactNumber}
        />
      </div>

      <div className="mt-10 flex flex-col items-start gap-3 rounded-lg border border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2.5 text-[13px] text-muted">
          <KeyRound aria-hidden className="size-4 text-gold" />
          Lost your reference? Call us and we&apos;ll find your booking.
        </p>
        <div className="flex gap-2">
          <Link
            href="/reserve"
            className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3.5 py-2 text-[12.5px] font-semibold text-[#1a1408] transition-colors hover:bg-gold-soft"
          >
            New reservation
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
          <a
            href={`tel:${settings.contactNumber.replace(/[^\d+]/g, "")}`}
            className="inline-flex items-center rounded-md border border-line px-3.5 py-2 text-[12.5px] font-medium text-muted transition-colors hover:text-foreground"
          >
            {settings.contactNumber}
          </a>
        </div>
      </div>
    </div>
  );
}
