import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, PhoneCall } from "lucide-react";
import { requireAdminPermission, can } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/config/app";
import { AppError } from "@/lib/errors";
import { getCustomerProfile } from "@/lib/services/admin/customers";
import { getClubSettings } from "@/lib/services/club-settings";
import { formatMoney } from "@/lib/utils/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatTile } from "@/components/admin/page-section";
import { CustomerEditForm } from "@/components/admin/customer-edit-form";
import type { ReservationStatusKey } from "@/components/ui/status-badge";

/**
 * A guest's history: what they booked, what they paid, how often they let a room
 * go to waste. The last figure is the one that decides whether a Saturday
 * booking for twenty people needs a deposit.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Guest" };

export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPermission(PERMISSIONS.CUSTOMER_VIEW);
  const { id } = await params;

  let profile;
  try {
    profile = await getCustomerProfile(id);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 404) notFound();
    throw error;
  }

  const settings = await getClubSettings();
  const { customer, stats } = profile;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <Link href="/admin/customers">
            <ArrowLeft aria-hidden />
            Guests
          </Link>
        </Button>
      </div>

      <PageHeader
        title={customer.name}
        description={`Profile created ${new Date(customer.joinedAt).toLocaleDateString("en-PH", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })} · bookings are matched on the mobile number`}
        actions={
          <>
            {customer.vip ? <Badge variant="gold">Regular</Badge> : null}
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${customer.mobile.replace(/\s/g, "")}`}>
                <PhoneCall aria-hidden />
                Call
              </a>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile dataStatId="visits" label="Bookings" value={stats.visits} hint={`${stats.completed} completed`} />
        <StatTile
          dataStatId="cancelled"
          label="Cancelled / refused"
          value={stats.cancelled}
          tone={stats.cancelled > 0 ? "warning" : "neutral"}
          hint={
            stats.cancellationRate === null
              ? "nothing decided yet"
              : `${stats.cancellationRate}% of decided bookings · ${stats.noShows} no-show(s)`
          }
        />
        <StatTile
          dataStatId="spend"
          label="Value booked"
          value={formatMoney(stats.spend, { currency: settings.currency })}
          tone="gold"
          hint={`${formatMoney(stats.collected, { currency: settings.currency })} collected`}
        />
        <StatTile
          dataStatId="last-visit"
          label="Last visit"
          value={stats.lastVisit ? new Date(stats.lastVisit).toLocaleDateString("en-PH") : "—"}
          hint={stats.firstVisit ? `first ${new Date(stats.firstVisit).toLocaleDateString("en-PH")}` : "no visits yet"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-[15px]">Booking history</CardTitle>
          </CardHeader>
          {profile.reservations.length === 0 ? (
            <CardContent>
              <EmptyState title="No bookings yet" description="This profile was created but nothing has been reserved under it." />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Night</TableHead>
                  <TableHead>Space</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profile.reservations.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/admin/reservations/${row.id}`} className="font-mono text-[12.5px] text-gold hover:underline">
                        {row.reference}
                      </Link>
                    </TableCell>
                    <TableCell className="text-[13px]">
                      {row.date}
                      <span className="block text-[11.5px] text-faint">
                        {row.startLabel}–{row.endLabel}
                      </span>
                    </TableCell>
                    <TableCell className="text-[13px]">{row.roomName}</TableCell>
                    <TableCell className="text-[13px]">{row.guests}</TableCell>
                    <TableCell className="text-[13px]">{formatMoney(row.amount, { currency: settings.currency })}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status as ReservationStatusKey} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <CustomerEditForm
            customerId={customer.id}
            customer={{ fullName: customer.name, mobile: customer.mobile, email: customer.email ?? "", notes: customer.notes ?? "" }}
            canEdit={can(session, PERMISSIONS.RESERVATION_EDIT)}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-[15px]">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {profile.payments.length === 0 ? (
                <p className="text-[13.5px] text-muted">Nothing recorded against these bookings.</p>
              ) : (
                <ul className="space-y-2">
                  {profile.payments.map((payment) => (
                    <li key={payment.id} className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-muted">
                        {new Date(payment.date).toLocaleDateString("en-PH")} · {payment.method}
                        {payment.status === "REFUNDED" ? <Badge variant="danger" className="ml-2">refund</Badge> : null}
                      </span>
                      <span className="font-medium">{formatMoney(payment.amount, { currency: settings.currency })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
