import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Info,
  Phone,
  Search,
  UserRound,
  Users,
} from "lucide-react";
import { getClubSettings } from "@/lib/services/club-settings";
import { getReservationByAccessToken } from "@/lib/services/reservations";
import { StatusBadge } from "@/components/ui/status-badge";
import { CopyButton } from "@/components/site/copy-button";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/utils/money";
import { formatClubDateLong, formatClubTime12h } from "@/lib/utils/datetime";
import { categoryLabel } from "@/components/site/room-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reservation confirmed",
  robots: { index: false, follow: false },
};

/**
 * Post-booking confirmation.
 *
 * Access requires the one-time `t` token that was returned when the reservation
 * was created, matched against the stored accessToken. Without it this page
 * shows nothing — so knowing (or guessing) a reference number is never enough to
 * read someone else's details.
 */
export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ reference }, { t }] = await Promise.all([params, searchParams]);
  const settings = await getClubSettings();

  const reservation = t
    ? await getReservationByAccessToken(reference, t, settings).catch(() => null)
    : null;

  if (!reservation) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 py-20 text-center sm:px-8">
        <div className="grid size-12 place-items-center rounded-full border border-line bg-card">
          <Search aria-hidden className="size-5 text-gold" />
        </div>
        <h1 className="mt-5 font-display text-2xl tracking-tight">
          This confirmation link has expired
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          For your privacy, confirmation links are unique to the device that made the
          booking. You can still view your reservation with your reference number and
          mobile number.
        </p>
        <Button asChild className="mt-6">
          <Link href="/lookup">
            Check my reservation
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    );
  }

  const startLabel = formatClubTime12h(reservation.startTime);
  const endLabel = formatClubTime12h(reservation.endTime);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-col items-center text-center">
        <span className="grid size-14 place-items-center rounded-full border border-success/30 bg-success/10">
          <CheckCircle2 aria-hidden className="size-7 text-success" />
        </span>
        <h1 className="mt-5 font-display text-3xl tracking-tight sm:text-4xl">
          Your space is held
        </h1>
        <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-muted">
          Thank you, {reservation.customerName.split(" ")[0]}. Our team will confirm your
          reservation shortly using the number you provided.
        </p>
      </div>

      {/* Reference */}
      <div className="mt-8 rounded-lg border border-gold/30 bg-gold/[0.06] p-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">
          Reservation reference
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <p className="select-all font-mono text-2xl font-semibold tracking-[0.12em] sm:text-3xl">
            {reservation.reference}
          </p>
          <CopyButton value={reservation.reference} label="Copy reference" />
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          Keep this number — you&apos;ll need it with your mobile number to check or cancel
          your booking.
        </p>
      </div>

      {/* Details */}
      <div className="mt-5 rounded-lg border border-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-faint">
            Reservation details
          </h2>
          <StatusBadge status={reservation.status} />
        </div>

        <dl className="divide-y divide-line">
          <Row icon={Users} label="Space" value={`${reservation.room.name} · ${categoryLabel(reservation.room.categorySlug)}`} />
          <Row icon={CalendarDays} label="Date" value={formatClubDateLong(reservation.date)} />
          <Row icon={Clock} label="Time" value={`${startLabel} – ${endLabel} (${reservation.durationMinutes} min)`} />
          <Row icon={UserRound} label="Guests" value={`${reservation.guestCount}`} />
          <Row icon={Phone} label="Mobile" value={reservation.mobileMasked} />
          {reservation.specialRequests ? (
            <Row icon={Info} label="Requests" value={reservation.specialRequests} />
          ) : null}
          <div className="flex items-baseline justify-between gap-4 p-5">
            <dt className="text-[13px] text-muted">Estimated total</dt>
            <dd className="text-2xl font-semibold">{formatMoney(reservation.estimatedAmount)}</dd>
          </div>
        </dl>
      </div>

      {/* Cancellation policy — part of the booking contract, shown on the receipt */}
      <div className="mt-5 rounded-lg border border-line bg-card p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-faint">
          Cancellation policy
        </h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
          {settings.cancellationPolicy}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          Bookings starting in less than {settings.cancellationCutoffHours} hours can be
          cancelled only with staff approval. To change or cancel, use{" "}
          <Link href="/lookup" className="text-gold underline-offset-4 hover:underline">
            Check my reservation
          </Link>{" "}
          or call {settings.contactNumber}.
        </p>
      </div>

      {/* Payment */}
      <Alert tone="info" title="Payment: at the club" className="mt-5">
        Nothing has been charged. Please settle the bill at the counter when you arrive —
        cash, GCash, Maya or card are accepted. The final amount may be adjusted by our
        team for add-ons.
      </Alert>

      {/* Status explainer */}
      <div className="mt-5 rounded-lg border border-line bg-surface/60 p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-faint">
          What happens next
        </h2>
        <ol className="mt-3 space-y-2.5 text-[13px] text-muted">
          <li className="flex gap-3">
            <span className="font-mono text-gold">01</span>
            Our team reviews the booking and confirms it — usually within the hour.
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-gold">02</span>
            You&apos;ll receive a text or call on {reservation.mobileMasked}.
          </li>
          <li className="flex gap-3">
            <span className="font-mono text-gold">03</span>
            Arrive 10 minutes early, quote your reference at the counter and pay.
          </li>
        </ol>
      </div>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="secondary">
          <Link href="/lookup">
            <Search className="size-4" />
            Check status later
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/rooms">
            Browse more spaces
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>

      <p className="mt-6 flex items-center justify-center gap-2 text-center text-[11.5px] text-faint">
        <CreditCard aria-hidden className="size-3.5" />
        Questions? Call {settings.contactNumber}
      </p>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-5">
      <dt className="flex items-center gap-2 text-[12.5px] text-faint">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </dt>
      <dd className="min-w-0 max-w-[65%] break-words text-right text-[13.5px] font-medium">
        {value}
      </dd>
    </div>
  );
}
