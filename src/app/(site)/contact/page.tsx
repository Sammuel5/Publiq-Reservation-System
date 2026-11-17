import { formatClubTime12h } from "@/lib/utils/datetime";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Clock, Mail, MapPin, Phone } from "lucide-react";
import { getClubSettings } from "@/lib/services/club-settings";
import { Button } from "@/components/ui/button";
import { DAY_LABELS, formatOperatingDays } from "@/lib/utils/opening-hours";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact & directions",
  description: "Address, phone number, email and opening hours for the club.",
};

export default async function ContactPage() {
  const settings = await getClubSettings();
  const tel = settings.contactNumber.replace(/[^\d+]/g, "");
  const mapsUrl =
    settings.mapUrl ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="max-w-2xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
          Contact
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight sm:text-5xl">
          Find us, call us
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          For same-night bookings or large groups, calling is fastest — our host team can
          help you find the right seating for your group.
        </p>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-card p-5">
          <MapPin aria-hidden className="size-5 text-gold" />
          <h2 className="mt-3 text-[14px] font-semibold">Address</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{settings.address}</p>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-[12.5px] font-medium text-gold underline-offset-4 hover:underline"
          >
            Open in maps
            <ArrowRight aria-hidden className="size-3.5" />
          </a>
        </div>

        <div className="rounded-lg border border-line bg-card p-5">
          <Phone aria-hidden className="size-5 text-gold" />
          <h2 className="mt-3 text-[14px] font-semibold">Phone</h2>
          <p className="mt-1.5 text-[13.5px] text-muted">
            <a href={`tel:${tel}`} className="inline-flex min-h-9 items-center transition-colors hover:text-foreground">
              {settings.contactNumber}
            </a>
          </p>
          <p className="mt-1 text-[12px] text-faint">
            Answered during operating hours.
          </p>
        </div>

        <div className="rounded-lg border border-line bg-card p-5">
          <Mail aria-hidden className="size-5 text-gold" />
          <h2 className="mt-3 text-[14px] font-semibold">Email</h2>
          <p className="mt-1.5 break-all text-[13.5px] text-muted">
            <a href={`mailto:${settings.email}`} className="inline-flex min-h-9 items-center break-all transition-colors hover:text-foreground">
              {settings.email}
            </a>
          </p>
          <p className="mt-1 text-[12px] text-faint">
            For events, corporate nights and press.
          </p>
        </div>

        <div className="rounded-lg border border-line bg-card p-5">
          <Clock aria-hidden className="size-5 text-gold" />
          <h2 className="mt-3 text-[14px] font-semibold">Hours</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
            {formatOperatingDays(settings.operatingDays, DAY_LABELS)}
            <br />
            {formatClubTime12h(settings.openingTime)} – {formatClubTime12h(settings.closingTime)} ({settings.timezone})
          </p>
        </div>
      </div>

      <div className="mt-10 flex flex-col gap-3 rounded-lg border border-line bg-surface/60 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">Ready to book?</h2>
          <p className="mt-1 text-[13px] text-muted">
            Live availability, instant reference, pay on arrival.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/reserve">
            Reservations
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
