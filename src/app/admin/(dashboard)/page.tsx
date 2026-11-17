import { formatClubTime12h } from "@/lib/utils/datetime";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CircleDollarSign,
  Database,
  MessageSquareWarning,
} from "lucide-react";
import { can, requireAdmin } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/config/app";
import { getDashboardData } from "@/lib/services/admin/dashboard";
import { formatMoney } from "@/lib/utils/money";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import { PageHeader, StatTile } from "@/components/admin/page-section";
import { Money } from "@/components/admin/money";
import { WalkInDialog } from "@/components/admin/walkin-form";
import { SweepButton } from "@/components/admin/sweep-button";
import type { ReservationStatusKey } from "@/components/ui/status-badge";
import { roomOptions } from "@/lib/services/admin/catalog";

/**
 * The shift overview.
 *
 * `dynamic = "force-dynamic"` throughout the console: every number here is a
 * live read of MongoDB, and a cached snapshot on a screen whose whole job is
 * "what is happening right now" would be worse than no screen.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function AdminDashboardPage() {
  const session = await requireAdmin();
  const [data, rooms] = await Promise.all([
    getDashboardData().catch(() => null),
    roomOptions().catch(() => []),
  ]);

  if (!data) {
    return (
      <ErrorState
        title="The console cannot read the database"
        description="The dashboard is temporarily unavailable. Contact a system administrator, then reload."
        action={can(session, PERMISSIONS.SYSTEM_VIEW) ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/system">Open system checks</Link>
          </Button>
        ) : undefined}
      />
    );
  }

  const canCreate = can(session, PERMISSIONS.RESERVATION_EDIT);
  const maxSeries = Math.max(1, ...data.series.map((point) => point.count));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Tonight · ${data.todayLabel}`}
        // Phase 1 promised the console would greet the person on shift, and this is
        // the screen they actually land on — the timezone line is what follows.
        description={`Welcome back, ${session.user.name.split(" ")[0]}. ${formatClubTime12h(data.clock.clubTime)} in the club's timezone (${data.timezone}); doors ${formatClubTime12h(data.clock.openingTime)}–${formatClubTime12h(data.clock.closingTime)}.`}
        actions={
          <>
            <Badge variant={data.clock.isOperatingNow ? "success" : "neutral"}>
              {data.clock.isOperatingNow ? "Open now" : "Closed"}
            </Badge>
            {canCreate ? (
              <WalkInDialog
                rooms={rooms}
                today={data.today}
                currency={data.currency}
              />
            ) : null}
          </>
        }
      />

      <div role="note" className="flex flex-col gap-2 border border-gold/25 bg-gold/5 px-4 py-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p>Dashboard figures below cover front-desk reservations only. Website seating bookings are listed separately.</p>
        <Link href="/admin/reservations#website-bookings" className="inline-flex min-h-11 shrink-0 items-center gap-2 font-semibold text-gold hover:text-gold-soft">View website bookings <ArrowRight aria-hidden className="size-4" /></Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          dataStatId="bookings-today"
          label="Bookings tonight"
          value={data.counts.todayBookings}
          hint={`${data.counts.confirmed} confirmed · ${data.counts.checkedIn} in spaces now`}
        />
        <StatTile
          dataStatId="pending"
          label="Awaiting approval"
          value={data.counts.pending}
          tone={data.counts.pending > 0 ? "warning" : "neutral"}
          hint={
            data.counts.pending > 0 ? (
              <Link href="/admin/reservations?status=PENDING" className="inline-flex items-center gap-1 text-gold hover:underline">
                Decide now <ArrowRight aria-hidden className="size-3" />
              </Link>
            ) : (
              "Nothing waiting"
            )
          }
        />
        <StatTile
          dataStatId="expected-tonight"
          label="Expected tonight"
          value={formatMoney(data.money.expectedTonight, { currency: data.currency })}
          hint={<>{formatMoney(data.money.collected, { currency: data.currency })} already collected</>}
        />
        <StatTile
          dataStatId="outstanding"
          label="Still to collect"
          value={formatMoney(data.money.outstanding, { currency: data.currency })}
          tone={data.money.outstanding > 0 ? "gold" : "success"}
          hint={`Occupancy ${data.occupancy.percent}% of the bookable night`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <AlertTriangle aria-hidden className="size-4 text-warning" />
              Needs a decision
            </CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link href="/admin/reservations">Open the board</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.attention.length === 0 && data.requests.length === 0 ? (
              <p className="text-[13.5px] text-muted">
                Nothing is waiting on you — every hold inside two hours has been confirmed and there are no
                cancellation requests open.
              </p>
            ) : null}

            {data.requests.map((row) => (
              <Link
                key={`req-${row.id}`}
                href={`/admin/reservations/${row.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/35 bg-warning/[0.07] px-3 py-2.5 transition-colors hover:border-warning/60"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[13.5px] font-medium">
                    <MessageSquareWarning aria-hidden className="size-3.5 text-warning" />
                    Wants to cancel · {row.reference}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {row.roomName} · {row.startLabel}
                    {row.reason ? ` · “${row.reason}”` : ""}
                  </span>
                </span>
                <Badge variant="warning">Decide</Badge>
              </Link>
            ))}

            {data.attention.map((row) => (
              <Link
                key={row.id}
                href={`/admin/reservations/${row.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface/60 px-3 py-2.5 transition-colors hover:border-line-strong"
              >
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-medium">
                    {row.guestName} · <span className="font-mono text-[12.5px] text-faint">{row.reference}</span>
                  </span>
                  <span className="block text-[12px] text-muted">
                    {row.roomName} · {row.startLabel} ·{" "}
                    {row.minutesUntilStart >= 0
                      ? `starts in ${humanMinutes(row.minutesUntilStart)}`
                      : `started ${humanMinutes(-row.minutesUntilStart)} ago`}
                  </span>
                </span>
                <StatusBadge status="PENDING" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <CalendarClock aria-hidden className="size-4 text-gold" />
              Arrivals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.arrivals.length === 0 ? (
              <p className="text-[13.5px] text-muted">
                No bookings in the next hour.{" "}
                <Link href="/admin/calendar" className="text-gold hover:underline">
                  See the whole night
                </Link>
                .
              </p>
            ) : null}
            {data.arrivals.map((row) => (
              <Link
                key={row.id}
                href={`/admin/reservations/${row.id}`}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 transition-colors hover:border-line-strong"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium">
                    {row.startLabel} · {row.guestName}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {row.roomName} · {row.guests} guests
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Money centavos={row.amount} currency={data.currency} muted />
                  <StatusBadge status={row.status as ReservationStatusKey} />
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,320px)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Last 7 nights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2" role="img" aria-label="Bookings per night over the last seven days">
              {data.series.map((point) => (
                <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <span className="text-[11px] text-faint">{point.count}</span>
                  <span
                    className="w-full rounded-t bg-gradient-to-t from-gold/25 to-gold/70"
                    style={{ height: `${Math.max(6, (point.count / maxSeries) * 96)}px` }}
                  />
                  <span className="text-[10.5px] uppercase tracking-wide text-faint">{point.label}</span>
                </div>
              ))}
            </div>
            <p className="pt-3 text-[12.5px] text-muted">
              {formatMoney(
                data.series.reduce((sum, point) => sum + point.amount, 0),
                { currency: data.currency },
              )}{" "}
              booked across these seven nights.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[15px]">Coming up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.upcoming.length === 0 ? (
              <p className="text-[13.5px] text-muted">Nothing booked beyond tonight yet.</p>
            ) : null}
            {data.upcoming.map((row) => (
              <Link
                key={row.id}
                href={`/admin/reservations/${row.id}`}
                className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-[13px] transition-colors hover:border-line-strong"
              >
                <span className="min-w-0">
                  <span className="block truncate">{row.dateLabel}</span>
                  <span className="block text-[12px] text-muted">
                    {row.startLabel} · {row.roomName}
                  </span>
                </span>
                <StatusBadge status={row.status as ReservationStatusKey} />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <CircleDollarSign aria-hidden className="size-4 text-gold" />
              Money
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-[13px]">
            <Line label="Confirmed value" value={formatMoney(data.money.confirmedValue, { currency: data.currency })} />
            <Line label="Pending, unvalued" value={formatMoney(data.money.pipeline, { currency: data.currency })} />
            <Line label="Collected tonight" value={formatMoney(data.money.collected, { currency: data.currency })} />
            <div className="border-t border-line pt-2.5">
              <Line
                label="Outstanding"
                value={
                  <span className={data.money.outstanding > 0 ? "font-semibold text-warning" : "font-semibold text-success"}>
                    {formatMoney(data.money.outstanding, { currency: data.currency })}
                  </span>
                }
              />
            </div>
            <Button asChild size="sm" variant="outline" className="mt-1 w-full">
              <Link href="/admin/payments">Payment ledger</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            {can(session, PERMISSIONS.SYSTEM_VIEW) ? <><Database aria-hidden className="size-3.5" />
            {data.health.database === "connected"
              ? `MongoDB connected · ${data.health.latencyMs ?? 0}ms · ${data.health.collections} collections`
              : `MongoDB ${data.health.database}`}
            <span aria-hidden>·</span></> : null}
            {data.counts.roomsActive} spaces on the floor · {data.counts.openBlocks} blocked window(s) ·{" "}
            {data.counts.newCustomersThisMonth} new guest(s) this month
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {can(session, PERMISSIONS.RESERVATION_STATUS) ? (
              <SweepButton />
            ) : null}
            {can(session, PERMISSIONS.SYSTEM_VIEW) ? <Button asChild size="sm" variant="ghost">
              <Link href="/admin/system">System checks</Link>
            </Button> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <p className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </p>
  );
}

function humanMinutes(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs < 60) return `${abs} min`;
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
