import mongoose from "mongoose";
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
  const websiteTotal = await websiteCollection.countDocuments();
  const websitePages = Math.max(1, Math.ceil(websiteTotal / 25));
  const requestedPage = Number(raw.websitePage ?? 1);
  const websitePage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, websitePages) : 1;
  const websiteRows = await websiteCollection.find({}, { projection: { reference: 1, seat: 1, night: 1, time: 1, guests: 1, minimumCentavos: 1, status: 1, name: 1, mobile: 1, googleEmail: 1 } }).sort({ createdAt: -1, _id: -1 }).skip((websitePage - 1) * 25).limit(25).toArray();
  return <div className="space-y-6">
    <PageHeader title="Reservations" description="Review and manage website seating bookings." />
      <section aria-labelledby="website-bookings" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="website-bookings" className="font-display text-2xl">Website seating bookings</h2>
            <p className="mt-1 text-sm text-muted">Website seating bookings, newest first.</p>
          </div>
          <Badge variant="neutral">{websiteTotal} total</Badge>
        </div>
        {websiteRows.length === 0 ? (
          <Card><CardContent><EmptyState title="No website seating bookings yet" description="Confirmed bookings from the website will appear here." /></CardContent></Card>
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
        <p className="text-xs text-muted">Staff can cancel confirmed bookings here. Check-in and payment recording are not yet available.</p>
      </section>

  </div>;
}
