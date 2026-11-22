import mongoose from "mongoose";
import Link from "next/link";
import { connectToDatabase } from "@/lib/db/mongoose";
import { formatClubTime12h } from "@/lib/utils/datetime";
import { requireAdminPermission, can } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/config/app";
import { getClubSettings } from "@/lib/services/club-settings";
import { filterParams } from "@/lib/validation/admin";
import { formatMoney } from "@/lib/utils/money";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { buildQuery, Pager } from "@/components/admin/query-controls";
import { PageHeader } from "@/components/admin/page-section";
import { CancelSeatingButton } from "@/components/admin/cancel-seating-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reservations" };
export default async function ReservationsBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAdminPermission(PERMISSIONS.RESERVATION_VIEW);
  const raw = filterParams(await searchParams);
  const settings = await getClubSettings();
  await connectToDatabase();
  const websiteCollection = mongoose.connection.db!.collection("publiq_seating_bookings");
  const showingCancelled = raw.status === "cancelled";
  const statusFilter = { status: showingCancelled ? "CANCELLED" : "CONFIRMED" };
  const websiteTotal = await websiteCollection.countDocuments(statusFilter);
  const websitePages = Math.max(1, Math.ceil(websiteTotal / 25));
  const requestedPage = Number(raw.websitePage ?? 1);
  const websitePage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, websitePages) : 1;
  const websiteRows = await websiteCollection.find(statusFilter, { projection: { reference: 1, seat: 1, night: 1, time: 1, guests: 1, minimumCentavos: 1, status: 1, name: 1, mobile: 1, googleEmail: 1 } }).sort({ createdAt: -1, _id: -1 }).skip((websitePage - 1) * 25).limit(25).toArray();
  return <div className="space-y-6">
    <PageHeader title="Reservations" description="Review and manage website seating bookings." />
      <section aria-labelledby="website-bookings" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="website-bookings" className="font-display text-2xl">Website seating bookings</h2>
            <p className="mt-1 text-sm text-muted">{showingCancelled ? "Cancelled reservations, newest first." : "Active reservations, newest first."}</p>
          </div>
          <Badge variant="neutral">{websiteTotal} total</Badge>
        </div>
        <nav aria-label="Reservation status" className="flex flex-wrap gap-2">
          <Link href="/admin/reservations" aria-current={!showingCancelled ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${!showingCancelled ? "border-gold/45 bg-gold/10 text-gold" : "border-line text-muted"}`}>Active</Link>
          <Link href="/admin/reservations?status=cancelled" aria-current={showingCancelled ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium ${showingCancelled ? "border-gold/45 bg-gold/10 text-gold" : "border-line text-muted"}`}>Cancelled history</Link>
        </nav>
        {websiteRows.length === 0 ? (
          <Card><CardContent><EmptyState title={showingCancelled ? "No cancelled bookings" : "No active bookings"} description={showingCancelled ? "Cancelled bookings will appear here." : "Confirmed bookings from the website will appear here."} /></CardContent></Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" aria-label="Website seating bookings">
            {websiteRows.map((row) => (
              <li key={String(row._id)} data-website-booking={String(row.reference)} className="rounded-lg border border-line bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="font-semibold">{String(row.name)}</p><p className="mt-0.5 break-all font-mono text-xs text-faint">{String(row.reference)}</p></div>
                  <Badge variant={row.status === "CANCELLED" ? "danger" : "success"}>{String(row.status).replaceAll("_", " ")}</Badge>
                </div>
                <p className="mt-3 text-sm"><strong>{String(row.seat)}</strong> · {String(row.night)} · {formatClubTime12h(String(row.time))}</p>
                <p className="mt-1 text-sm text-muted">{Number(row.guests)} guests · Consumable minimum: {formatMoney(Number(row.minimumCentavos), { currency: settings.currency })}</p>
                <p className="mt-2 break-all text-sm text-muted">{String(row.mobile)} · {String(row.googleEmail)}</p>
                {row.status === "CONFIRMED" && can(session, PERMISSIONS.SEATING_CANCEL) ? <div className="mt-4"><CancelSeatingButton id={String(row._id)} reference={String(row.reference)} seat={String(row.seat)} night={String(row.night)} /></div> : null}
              </li>
            ))}
          </ul>
        )}
        <Pager page={websitePage} totalPages={websitePages} total={websiteTotal} unit="website booking" buildHref={(page) => `/admin/reservations${buildQuery({ ...raw, websitePage: page })}#website-bookings`} />
        <p className="text-xs text-muted">Cancelling removes a booking from Active, releases the space for that night, and keeps a record in Cancelled history.</p>
      </section>

  </div>;
}
