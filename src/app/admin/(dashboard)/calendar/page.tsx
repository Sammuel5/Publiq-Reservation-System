import { PERMISSIONS } from "@/config/app";
import { formatClubTime12h } from "@/lib/utils/datetime";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdminPermission } from "@/lib/auth/guards";
import { buildCalendar } from "@/lib/services/admin/reservations";
import { getClubSettings } from "@/lib/services/club-settings";
import { addDaysToDateString, formatClubDateLong, isDateString, todayInClubTime } from "@/lib/utils/calendar-read";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { STATUS_DOT_CLASSES } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/admin/page-section";

/**
 * The night grid: every room as a lane, the operating window as the horizontal
 * axis, bookings as bars.
 *
 * It is a read-only projection of the same availability context the website
 * uses, so what staff see here and what a guest can book cannot drift. An
 * overnight close (14:00 → 02:00) is laid out as one continuous night rather
 * than being cut at midnight, which is how the floor actually thinks about it.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Night grid" };

const STATUS_TONE: Record<string, string> = {
  PENDING: "warning",
  CONFIRMED: "info",
  CHECKED_IN: "success",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPermission(PERMISSIONS.RESERVATION_VIEW);
  const raw = await searchParams;
  const requested = typeof raw.date === "string" && isDateString(raw.date) ? raw.date : undefined;
  const settings = await getClubSettings();
  const today = todayInClubTime(settings);
  const date = requested ?? today;

  const grid = await buildCalendar(date, settings);
  const nightStart = new Date(`${date}T00:00:00Z`);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Night grid"
        description={`${formatClubDateLong(date)} · open ${formatClubTime12h(grid.openingTime)} → ${formatClubTime12h(grid.closingTime)} · ${grid.totals.bookings} booking(s) across ${grid.totals.rooms} spaces · ${grid.totals.occupancy}% occupancy`}
        actions={
          <div className="flex items-center gap-1.5">
            <Button asChild size="sm" variant="ghost" aria-label="Previous night">
              <Link href={`/admin/calendar?date=${addDaysToDateString(date, -1)}`}>
                <ChevronLeft aria-hidden />
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/admin/calendar?date=${today}`}>Tonight</Link>
            </Button>
            <Button asChild size="sm" variant="ghost" aria-label="Next night">
              <Link href={`/admin/calendar?date=${addDaysToDateString(date, 1)}`}>
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          </div>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="flex border-b border-line bg-surface/60">
                <div className="w-32 shrink-0 border-r border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-faint">
                  Space
                </div>
                <div className="flex flex-1">
                  {grid.slots.map((slot) => (
                    <span
                      key={slot}
                      className="flex-1 border-r border-line/60 px-1 py-2 text-[10.5px] text-faint last:border-r-0"
                    >
                      {formatClubTime12h(slot)}
                    </span>
                  ))}
                </div>
              </div>

              {grid.cells.map((cell) => (
                <div key={cell.roomId} className="flex border-b border-line last:border-b-0">
                  <div className="w-32 shrink-0 border-r border-line px-3 py-2.5">
                    <span className="block truncate text-[13px] font-medium">{cell.roomName}</span>
                    <span className="block text-[11px] text-faint">{cell.rows.length} booked</span>
                  </div>
                  <div className="relative h-[58px] flex-1">
                    {grid.slots.slice(0, -1).map((slot, index) => (
                      <span
                        key={slot}
                        aria-hidden
                        className="absolute inset-y-0 border-r border-line/40"
                        style={{ left: `${((index + 1) / (grid.slots.length - 1 || 1)) * 100}%` }}
                      />
                    ))}

                    {grid.blocks
                      .filter((block) => block.roomId === null || block.roomId === cell.roomId)
                      .map((block) => {
                        const startOffset =
                          (new Date(block.startAt).getTime() - nightStart.getTime()) / 60_000;
                        const width = (new Date(block.endAt).getTime() - new Date(block.startAt).getTime()) / 60_000;
                        const left = Math.max(0, Math.min(96, (startOffset / (grid.nightMinutes || 1)) * 100));
                        return (
                          <span
                            key={`block-${block.id}`}
                            title={block.reason ?? "Blocked"}
                            className="absolute top-1/2 h-8 -translate-y-1/2 rounded border border-dashed border-danger/50 bg-danger/[0.08]"
                            style={{
                              left: `${left}%`,
                              width: `${Math.max(2, (width / (grid.nightMinutes || 1)) * 100)}%`,
                            }}
                          />
                        );
                      })}

                    {cell.rows.map((row) => (
                      <Link
                        key={row.id}
                        href={`/admin/reservations/${row.id}`}
                        className="group absolute top-1/2 flex h-9 -translate-y-1/2 items-center gap-1.5 overflow-hidden rounded-md border border-line bg-card-elevated px-2 text-[11.5px] transition-colors hover:border-gold/60"
                        style={{
                          left: `${Math.max(0, Math.min(94, row.left))}%`,
                          width: `${Math.max(6, row.width)}%`,
                        }}
                        title={`${row.label} · ${row.durationMinutes} min`}
                      >
                        <span
                          aria-hidden
                          className={`size-1.5 shrink-0 rounded-full ${
                            STATUS_DOT_CLASSES[STATUS_TONE[row.status] ?? "neutral"]
                          }`}
                        />
                        <span className="truncate text-foreground group-hover:text-gold">{row.label}</span>
                      </Link>
                    ))}

                    {cell.rows.length === 0 ? (
                      <span className="absolute inset-y-0 left-2 flex items-center text-[12px] text-faint">
                        Free all night
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-warning" /> Pending
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-info" /> Confirmed
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full bg-success" /> In space
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3 w-6 rounded border border-dashed border-danger/50 bg-danger/[0.08]"
          />
          Blocked window
        </span>
        <Badge variant="neutral" className="ml-auto max-w-full whitespace-normal">
          Bars follow the club clock, not midnight
        </Badge>
      </div>
    </div>
  );
}
