import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  ExternalLink,
  MapPin,
  Printer,
  UserRound,
  Users,
} from "lucide-react";
import { can, requireAdminPermission } from "@/lib/auth/guards";
import { actorFromSession } from "@/lib/services/admin/shared";
import { PERMISSIONS } from "@/config/app";
import { AppError } from "@/lib/errors";
import { getReservationDetail } from "@/lib/services/admin/reservations";
import { roomOptions } from "@/lib/services/admin/catalog";
import { getClubSettings } from "@/lib/services/club-settings";
import { formatMoney } from "@/lib/utils/money";
import { formatClubDateTime } from "@/lib/utils/datetime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/admin/page-section";
import { ReservationConsole } from "@/components/admin/reservation-console";

/**
 * One reservation, everything about it.
 *
 * The header is deliberately a printable summary: front desks print the
 * reference card for walk-ins and phone bookings, so it holds the guest name,
 * room, time and amount without any controls in the way.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reservation" };

export default async function ReservationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdminPermission(PERMISSIONS.RESERVATION_VIEW);
  const { id } = await params;

  let detail;
  try {
    detail = await getReservationDetail(id, actorFromSession(session));
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) notFound();
    throw error;
  }

  const [rooms, settings] = await Promise.all([
    roomOptions().catch(() => []),
    getClubSettings(),
  ]);
  const { reservation } = detail;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link href="/admin/reservations">
            <ArrowLeft aria-hidden />
            Board
          </Link>
        </Button>
        <span className="text-[12.5px] text-faint">Reservation</span>
      </div>

      <PageHeader
        title={reservation.reference}
        description={`${reservation.customerName} · ${reservation.roomName} · ${reservation.dateLabel} ${reservation.startLabel}–${reservation.endLabel}`}
        actions={
          <>
            <StatusBadge status={reservation.status} />
            <Badge variant={reservation.source === "ADMIN" ? "purple" : "outline"}>
              {reservation.source === "ADMIN" ? "Front desk" : "Website"}
            </Badge>
            {reservation.roomSlug ? (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/rooms/${reservation.roomSlug}`} target="_blank" rel="noreferrer">
                  Space page
                  <ExternalLink aria-hidden />
                </Link>
              </Button>
            ) : null}
            <Button asChild size="sm" variant="ghost" className="print:hidden">
              <Link
                href={`/confirmation/${reservation.reference}?t=&print=1`}
                target="_blank"
                rel="noreferrer"
                aria-label="Open the guest's confirmation view"
              >
                <Printer aria-hidden />
                Guest view
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-[15px]">Booking</CardTitle>
            <span className="text-[13px] font-semibold text-gold">
              {formatMoney(reservation.amount, { currency: reservation.currency })}
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            <Detail icon={<CalendarDays aria-hidden />} label="Night">
              {reservation.dateLabel}
              {reservation.isToday ? <Badge variant="gold" className="ml-2">Tonight</Badge> : null}
            </Detail>
            <Detail icon={<Clock aria-hidden />} label="Time">
              {reservation.startLabel} – {reservation.endLabel} · {reservation.durationMinutes} minutes
            </Detail>
            <Detail icon={<MapPin aria-hidden />} label="Space">
              {reservation.roomName}
              <span className="text-faint">
                {" "}
                · seats {reservation.roomCapacity}
                {reservation.overCapacity ? (
                  <span className="text-danger"> · party of {reservation.guestCount} is over capacity</span>
                ) : null}
              </span>
            </Detail>
            <Detail icon={<Users aria-hidden />} label="Party">
              <Link href={`/admin/customers/${detail.customerId ?? ""}`} className="text-gold hover:underline">
                {reservation.guestCount} guests
              </Link>
            </Detail>
            <Detail icon={<UserRound aria-hidden />} label="Contact">
              {reservation.customerMobile}
              {reservation.customerEmail ? <span className="text-faint"> · {reservation.customerEmail}</span> : null}
            </Detail>
            {reservation.specialRequests ? (
              <Detail icon={<Printer aria-hidden />} label="Requests">
                {reservation.specialRequests}
              </Detail>
            ) : null}
            <p className="border-t border-line pt-3 text-[12px] text-faint">
              Booked {formatClubDateTime(new Date(reservation.createdAt), settings.timezone)} · balance{" "}
              {formatMoney(detail.balances.outstanding, { currency: reservation.currency })} outstanding
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {detail.timeline
                .slice()
                .reverse()
                .map((entry, index) => (
                  <li key={`${entry.changedAt}-${index}`} className="flex gap-3">
                    <span className="mt-1.5 flex flex-col items-center">
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${index === 0 ? "bg-gold" : "bg-line-strong"}`}
                      />
                      {index < detail.timeline.length - 1 ? (
                        <span aria-hidden className="mt-1 h-full w-px flex-1 bg-line" />
                      ) : null}
                    </span>
                    <span className="min-w-0 pb-1">
                      <span className="flex flex-wrap items-center gap-2 text-[13px]">
                        {entry.from && entry.from !== entry.to ? (
                          <>
                            <span className="text-faint line-through">{entry.from}</span>
                            <span aria-hidden>→</span>
                          </>
                        ) : null}
                        <span className="font-medium">{entry.to}</span>
                        <Badge variant={entry.actorType === "ADMIN" ? "info" : entry.actorType === "CUSTOMER" ? "purple" : "neutral"}>
                          {entry.actorType.toLowerCase()}
                        </Badge>
                      </span>
                      {entry.reason ? (
                        <span className="block text-[12.5px] leading-relaxed text-muted">{entry.reason}</span>
                      ) : null}
                      <span className="block text-[11.5px] text-faint">
                        {formatClubDateTime(new Date(entry.changedAt), settings.timezone)}
                        {entry.actorName ? ` · ${entry.actorName}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="print:hidden">
        <ReservationConsole
          reservationId={reservation.id}
          detail={detail}
          rooms={rooms}
          currency={reservation.currency}
          timezone={settings.timezone}
          can={{
            status: can(session, PERMISSIONS.RESERVATION_STATUS),
            checkIn: can(session, PERMISSIONS.RESERVATION_CHECK_IN),
            decide: can(session, PERMISSIONS.RESERVATION_DECIDE),
            edit: can(session, PERMISSIONS.RESERVATION_EDIT),
            payment: can(session, PERMISSIONS.PAYMENT_RECORD),
            paymentManage: can(session, PERMISSIONS.PAYMENT_MANAGE),
          }}
        />
      </div>
    </div>
  );
}

function Detail({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className="mt-0.5 text-faint [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">{label}</span>
        <span className="block text-[13.5px] leading-relaxed text-foreground">{children}</span>
      </span>
    </div>
  );
}
