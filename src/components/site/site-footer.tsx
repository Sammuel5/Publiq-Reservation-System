import { formatClubTime12h } from "@/lib/utils/datetime";
import Link from "next/link";
import { PubliqLogo } from "@/components/brand/publiq-logo";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import type { ClubSettingsView } from "@/lib/services/club-settings";
import { DAY_LABELS, formatOperatingDays } from "@/lib/utils/opening-hours";

export function SiteFooter({ settings }: { settings: ClubSettingsView }) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1.3fr_1fr_1fr] lg:py-16">
        <div>
          <Link href="/" aria-label={`${settings.clubName} — home`} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold">
            <PubliqLogo decorative className="w-36" />
          </Link>
          <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-muted">
            Booths, couches and signature nights at PUBLIQ.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/reserve"
              className="rounded-md border border-gold/40 px-3.5 py-2 text-[12.5px] font-medium text-gold transition-colors hover:bg-gold/10"
            >
              Reservations
            </Link>
            <Link
              href="/my-seating-bookings"
              className="rounded-md border border-line px-3.5 py-2 text-[12.5px] font-medium text-muted transition-colors hover:text-foreground"
            >
              Check my booking
            </Link>
          </div>
        </div>

        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            Visit
          </h2>
          <ul className="mt-4 space-y-3 text-[13.5px] text-muted">
            <li className="flex gap-2.5">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-gold/70" />
              <span className="leading-relaxed">{settings.address}</span>
            </li>
            <li className="flex gap-2.5">
              <Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-gold/70" />
              <a
                href={`tel:${settings.contactNumber.replace(/[^\d+]/g, "")}`}
                className="inline-flex min-h-9 items-center transition-colors hover:text-foreground"
              >
                {settings.contactNumber}
              </a>
            </li>
            <li className="flex gap-2.5">
              <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-gold/70" />
              <a
                href={`mailto:${settings.email}`}
                className="inline-flex min-h-9 items-center break-all transition-colors hover:text-foreground"
              >
                {settings.email}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            Hours
          </h2>
          <ul className="mt-4 space-y-3 text-[13.5px] text-muted">
            <li className="flex gap-2.5">
              <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-gold/70" />
              <span>
                {formatOperatingDays(settings.operatingDays, DAY_LABELS)}
                <br />
                {formatClubTime12h(settings.openingTime)} – {formatClubTime12h(settings.closingTime)}
              </span>
            </li>
          </ul>

          <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            Explore
          </h2>
          <ul className="mt-3 space-y-2 text-[13.5px] text-muted">
            <li>
              <Link href="/spaces" className="inline-flex min-h-9 items-center transition-colors hover:text-foreground">
                Seating
              </Link>
            </li>
            <li>
              <Link href="/about" className="inline-flex min-h-9 items-center transition-colors hover:text-foreground">
                About the club
              </Link>
            </li>
            <li>
              <Link href="/contact" className="inline-flex min-h-9 items-center transition-colors hover:text-foreground">
                Contact
              </Link>
            </li>
            <li>
              <Link href="/admin/login" className="inline-flex min-h-9 items-center transition-colors hover:text-foreground">
                Staff sign-in
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-5 text-[11.5px] text-faint sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>
            © {year} {settings.clubName}. All rights reserved.
          </p>
          <p>Reservations are subject to availability · Payment at the club</p>
        </div>
      </div>
    </footer>
  );
}
