import mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import { formatClubTime12h } from "@/lib/utils/datetime";
import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { requireAdminPermission, can } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/config/app";
import { listReservations, sweepExpiredPending } from "@/lib/services/admin/reservations";
import { getClubSettings } from "@/lib/services/club-settings";
import { filterParams, reservationQuerySchema } from "@/lib/validation/admin";
import { formatMoney } from "@/lib/utils/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  buildQuery,
  FilterField,
  FilterForm,
  Pager,
  SelectFilter,
  TextFilter,
} from "@/components/admin/query-controls";
import { PageHeader } from "@/components/admin/page-section";
import { ReservationRowActions } from "@/components/admin/reservation-row-actions";
import { WalkInDialog } from "@/components/admin/walkin-form";
import { roomOptions } from "@/lib/services/admin/catalog";
import type { ReservationStatusKey } from "@/components/ui/status-badge";

/**
 * The reservations board.
 *
 * Filters live in the URL, not in React state, for a selfish reason: a manager
 * who wants "tonight, pending, VIP room" on the staff phone at 10pm should be
 * able to bookmark it, and the browser Back button should behave. The page reads
 * the same query the API does (`reservationQuerySchema`), so the two can never
 * disagree about what a filter means.
 *
 * Opening the "today" view also releases lapsed pending holds — an indexed query
 * that normally matches nothing — so the board cannot show a room as taken by a
 * booking nobody intends to honour.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reservations" };

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "PENDING", label: "Pending" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "CHECKED_IN", label: "Checked in" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "NO_SHOW", label: "No-show" },
  { value: "REJECTED", label: "Rejected" },
  { value: "EXPIRED", label: "Expired" },
  { value: "ATTENTION", label: "Needs attention" },
];

export default async function ReservationsBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminPermission(PERMISSIONS.RESERVATION_VIEW);
  const raw = filterParams(await searchParams);
  const settings = await getClubSettings();

  // A bookmarked or hand-edited URL must not be able to error the page: the
  // same schema the API rejects with a 422 is treated here as "fall back to the
  // default view", so the board always renders.
  const parsed = reservationQuerySchema.safeParse(raw);
  const query = parsed.success ? parsed.data : reservationQuerySchema.parse({});
  const view = query.view;

  // Opportunistic sweep, but only for the live views: an audit query over
  // "all" should never mutate.
  if (view === "today" && can(session, PERMISSIONS.RESERVATION_STATUS)) await sweepExpiredPending().catch(() => undefined);

  await connectToDatabase();
  const websiteCollection = mongoose.connection.db!.collection("publiq_seating_bookings");
  const websiteTotal = await websiteCollection.countDocuments();
  const websitePages = Math.max(1, Math.ceil(websiteTotal / 25));
  const requestedPage = Number(raw.websitePage ?? 1);
  const websitePage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, websitePages) : 1;
  const websiteRows = await websiteCollection.find({}, { projection: { reference: 1, seat: 1, night: 1, time: 1, guests: 1, minimumCentavos: 1, status: 1, name: 1, mobile: 1, googleEmail: 1 } }).sort({ createdAt: -1, _id: -1 }).skip((websitePage - 1) * 25).limit(25).toArray();

  const [board, rooms] = await Promise.all([
    listReservations(parsed.success ? raw : {}, settings),
    roomOptions().catch(() => []),
  ]);
  const canCreate = can(session, PERMISSIONS.RESERVATION_EDIT);
  const canDecide = can(session, PERMISSIONS.RESERVATION_DECIDE);
  const canStatus = can(session, PERMISSIONS.RESERVATION_STATUS);

  const baseHref = {
    view: query.view,
    status: query.status.join(","),
    room: query.room ?? "",
    source: query.source ?? "",
    q: query.q ?? "",
    from: query.from ?? "",
    to: query.to ?? "",
    sort: query.sort,
    dir: query.dir,
    perPage: String(query.perPage),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reservations"
        description={
          view === "today"
            ? `Tonight, ${board.today}. Approvals, check-ins and close-outs happen here.`
            : view === "upcoming"
              ? "Everything booked from tomorrow onwards that still needs something."
              : `Custom window · ${board.window.from} → ${board.window.to}`
        }
        actions={
          canCreate ? (
            <WalkInDialog rooms={rooms} today={board.today} currency={settings.currency} />
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href="/">
                Open the website
                <ExternalLink aria-hidden />
              </Link>
            </Button>
          )
        }
      />

      <section aria-labelledby="website-bookings" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="website-bookings" className="font-display text-2xl">Website seating bookings</h2>
            <p className="mt-1 text-sm text-muted">All confirmed website seating bookings, newest first. These are separate from the front-desk filters below.</p>
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
                  <Badge variant="success">{String(row.status).replaceAll("_", " ")}</Badge>
                </div>
                <p className="mt-3 text-sm"><strong>{String(row.seat)}</strong> · {String(row.night)} · {formatClubTime12h(String(row.time))}</p>
                <p className="mt-1 text-sm text-muted">{Number(row.guests)} guests · Consumable minimum: {formatMoney(Number(row.minimumCentavos), { currency: settings.currency })}</p>
                <p className="mt-2 break-all text-sm text-muted">{String(row.mobile)} · {String(row.googleEmail)}</p>
              </li>
            ))}
          </ul>
        )}
        <Pager page={websitePage} totalPages={websitePages} total={websiteTotal} unit="website booking" buildHref={(page) => `/admin/reservations${buildQuery({ ...raw, websitePage: page })}#website-bookings`} />
        <p className="text-xs text-muted">Website bookings currently appear for viewing only. Check-in, payments and front-desk actions are not yet available for them.</p>
      </section>

      <div className="border-t border-line pt-5"><h2 className="font-display text-2xl">Front-desk reservations</h2><p className="mt-1 text-sm text-muted">The date tabs, filters, totals and actions below apply only to front-desk reservations.</p></div>
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Date range">
        {(["today", "upcoming", "all"] as const).map((candidate) => (
          <Link
            key={candidate}
            href={`/admin/reservations${buildQuery({ ...baseHref, view: candidate, page: 1 })}`}
            aria-current={query.view === candidate ? "page" : undefined}
            className={`min-h-9 rounded-md border px-3 text-[13px] capitalize transition-colors ${
              query.view === candidate
                ? "border-gold/45 bg-gold/10 font-semibold text-gold"
                : "border-line text-muted hover:border-line-strong hover:text-foreground"
            }`}
          >
            {candidate === "all" ? "Custom range" : candidate}
          </Link>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
          <Badge variant="neutral">{board.page.total} shown</Badge>
          <Badge variant="warning">{board.counts.status.PENDING ?? 0} pending</Badge>
          <Badge variant="info">{board.counts.status.CONFIRMED ?? 0} confirmed</Badge>
          <Badge variant="success">{board.counts.status.CHECKED_IN ?? 0} in spaces</Badge>
        </span>
      </div>

      <FilterForm
        action="/admin/reservations"
        resetHref="/admin/reservations"
        hidden={{ view: query.view, perPage: String(query.perPage), page: "1" }}
      >
        <FilterField label="Search" name="q">
          <TextFilter name="q" value={query.q} placeholder="Reference, name or mobile…" />
        </FilterField>
        <FilterField label="Status" name="status">
          <SelectFilter name="status" value={query.status[0] ?? ""} options={STATUS_OPTIONS} />
        </FilterField>
        <FilterField label="Space" name="room">
          <SelectFilter
            name="room"
            value={query.room ?? ""}
            options={[
              { value: "", label: "All spaces" },
              ...board.rooms.map((room) => ({ value: room.id, label: room.name })),
            ]}
          />
        </FilterField>
        <FilterField label="Source" name="source">
          <SelectFilter
            name="source"
            value={query.source ?? ""}
            options={[
              { value: "", label: "Any source" },
              { value: "CUSTOMER", label: "Website" },
              { value: "ADMIN", label: "Front desk" },
            ]}
          />
        </FilterField>
        {query.view === "all" ? (
          <>
            <FilterField label="From" name="from">
              <TextFilter name="from" type="date" value={query.from} />
            </FilterField>
            <FilterField label="To" name="to">
              <TextFilter name="to" type="date" value={query.to} />
            </FilterField>
          </>
        ) : null}
        <FilterField label="Sort" name="sort">
          <SelectFilter
            name="sort"
            value={query.sort}
            options={[
              { value: "startAt", label: "Start time" },
              { value: "createdAt", label: "Booked when" },
              { value: "amount", label: "Value" },
            ]}
          />
        </FilterField>
        <FilterField label="Direction" name="dir">
          <SelectFilter
            name="dir"
            value={query.dir}
            options={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
          />
        </FilterField>
      </FilterForm>

      <Card className="overflow-hidden">
        {board.page.rows.length === 0 ? (
          <CardContent>
            <EmptyState
              title="Nothing matches this view"
              description="Widen the date range or clear the status filter. Website seating bookings appear in the separate section above."
            />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guest</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Space</TableHead>
                <TableHead>Party</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.page.rows.map((row) => (
                <TableRow key={row.id} data-reservation={row.reference}>
                  <TableCell>
                    <Link href={`/admin/reservations/${row.id}`} className="group block min-w-0">
                      <span className="block text-[13.5px] font-medium group-hover:text-gold">
                        {row.customerName}
                      </span>
                      <span className="block font-mono text-[11.5px] text-faint">{row.reference}</span>
                      {row.specialRequests ? (
                        <span className="mt-0.5 block max-w-[240px] truncate text-[11.5px] text-muted">
                          “{row.specialRequests}”
                        </span>
                      ) : null}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="block text-[13px]">
                      {row.isToday ? "Tonight" : row.dateLabel} · {row.startLabel}–{row.endLabel}
                    </span>
                    <span className="block text-[11.5px] text-faint">
                      {row.durationMinutes} min
                      {row.status === "PENDING"
                        ? row.minutesUntilStart >= 0
                          ? ` · in ${Math.max(0, Math.round(row.minutesUntilStart / 60))} h`
                          : " · started"
                        : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block text-[13px]">{row.roomName}</span>
                    {row.overCapacity ? (
                      <span className="block text-[11.5px] text-danger">
                        over capacity ({row.guestCount}/{row.roomCapacity})
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {row.guestCount}
                    <span className="block text-[11.5px] text-faint">{row.source === "ADMIN" ? "desk" : "web"}</span>
                  </TableCell>
                  <TableCell className="text-[13px]">
                    {formatMoney(row.amount, { currency: row.currency })}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={row.status as ReservationStatusKey} />
                      {row.pendingRequest === "PENDING" ? <Badge variant="warning">wants to cancel</Badge> : null}
                      {row.needsAttention && row.pendingRequest !== "PENDING" ? (
                        <Badge variant="danger">{row.attentionReason}</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <ReservationRowActions
                        id={row.id}
                        status={row.status}
                        reference={row.reference}
                        canDecide={canDecide}
                        canStatus={canStatus}
                      />
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/reservations/${row.id}`}>Open</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">
          Value of what is listed: {formatMoney(board.money.expected, { currency: settings.currency })} ·
          collected {formatMoney(board.money.collected, { currency: settings.currency })}
        </p>
        <Pager
          page={board.page.page}
          totalPages={board.page.totalPages}
          total={board.page.total}
          unit="booking"
          buildHref={(page) => `/admin/reservations${buildQuery({ ...baseHref, page })}`}
        />
      </div>
    </div>
  );
}
