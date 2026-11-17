import { Customer, Payment, Reservation, Room, RoomBlock } from "@/lib/db/models";
import { getClubSettings } from "@/lib/services/club-settings";
import { todayInClubTime, MAX_ADVANCE_DAYS } from "@/lib/services/availability";
import { addDaysToDateString, formatClubDateLong, formatClubTime12h } from "@/lib/utils/datetime";
import { getSystemStatus } from "@/lib/services/system-status";
/**
 * The opening screen: what the club needs to know before it opens the doors.
 *
 * Nothing here is decorative — each tile answers a question the manager would
 * otherwise ask staff on the phone: how many bookings are on for tonight, how
 * much of the night is sold, who is still unconfirmed, and what has actually
 * been paid. All figures are aggregated in MongoDB from the same collections
 * the customer site writes to, so the console and the website can never
 * disagree.
 */

export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;

export async function getDashboardData() {
  const settings = await getClubSettings();
  const today = todayInClubTime(settings);
  const weekAgo = addDaysToDateString(today, -6);
  const horizon = addDaysToDateString(today, MAX_ADVANCE_DAYS);
  const now = new Date();

  const [
    statusCounts,
    todayRows,
    upcomingRows,
    attentionRows,
    requestRows,
    trendRows,
    revenueToday,
    roomCount,
    blockCount,
    newCustomers,
    system,
  ] = await Promise.all([
    Reservation.aggregate<{ _id: string; count: number; amount: number }>([
      { $match: { reservationDate: { $gte: today, $lte: horizon } } },
      { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$estimatedAmount" } } },
    ]),
    Reservation.find({ reservationDate: today })
      .sort({ startAt: 1 })
      .limit(8)
      .populate<{ room: { name: string } | null }>("room", "name")
      .populate<{ customer: { fullName: string; mobileNumber: string } | null }>("customer", "fullName mobileNumber")
      .lean(),
    Reservation.find({ reservationDate: { $gt: today }, status: { $in: ["PENDING", "CONFIRMED"] } })
      .sort({ startAt: 1 })
      .limit(6)
      .populate<{ room: { name: string } | null }>("room", "name")
      .lean(),
    Reservation.find({ status: "PENDING", reservationDate: { $gte: weekAgo, $lte: horizon } })
      .sort({ startAt: 1 })
      .limit(6)
      .populate<{ room: { name: string } | null }>("room", "name")
      .populate<{ customer: { fullName: string; mobileNumber: string } | null }>("customer", "fullName mobileNumber")
      .lean(),
    Reservation.find({ "cancellationRequest.status": "PENDING", status: { $in: ["PENDING", "CONFIRMED", "CHECKED_IN"] } })
      .sort({ startAt: 1 })
      .limit(6)
      .populate<{ room: { name: string } | null }>("room", "name")
      .lean(),
    Reservation.aggregate<{ _id: string; count: number; amount: number }>([
      { $match: { reservationDate: { $gte: weekAgo, $lte: today } } },
      { $group: { _id: "$reservationDate", count: { $sum: 1 }, amount: { $sum: "$estimatedAmount" } } },
    ]),
    revenueForDates(settings.currency, today),
    Room.countDocuments({ isActive: true }),
    RoomBlock.countDocuments({ isActive: true, endAt: { $gte: now } }),
    Customer.countDocuments({ createdAt: { $gte: new Date(`${today.slice(0, 7)}-01T00:00:00Z`) } }),
    getSystemStatus().catch(() => null),
  ]);

  const byStatus = new Map(statusCounts.map((row) => [row._id, row]));
  const count = (status: string) => byStatus.get(status)?.count ?? 0;
  const amountOf = (status: string) => byStatus.get(status)?.amount ?? 0;

  const openNightMinutes = operatingMinutes(settings.openingTime, settings.closingTime);
  const bookedMinutes = todayRows
    .filter((row) => ["PENDING", "CONFIRMED", "CHECKED_IN"].includes(row.status))
    .reduce((sum, row) => sum + row.durationMinutes, 0);
  const occupancy = roomCount > 0 ? Math.min(100, Math.round((bookedMinutes / (roomCount * openNightMinutes)) * 100)) : 0;

  const trend = new Map(trendRows.map((row) => [row._id, row]));
  const series = Array.from({ length: 7 }, (_unused, index) => {
    const date = addDaysToDateString(weekAgo, index);
    const row = trend.get(date);
    return {
      date,
      label: formatClubDateLong(date).split(",")[0]?.slice(0, 3) ?? date.slice(8),
      count: row?.count ?? 0,
      amount: row?.amount ?? 0,
    };
  });

  return {
    today,
    todayLabel: formatClubDateLong(today),
    currency: settings.currency,
    timezone: settings.timezone,
    clock: {
      clubTime: now.toLocaleTimeString("en-GB", { timeZone: settings.timezone, hour: "2-digit", minute: "2-digit" }),
      isOperatingNow: isWithinOperatingWindow(settings.openingTime, settings.closingTime, now, settings.timezone),
      openingTime: settings.openingTime,
      closingTime: settings.closingTime,
    },
    counts: {
      todayBookings: todayRows.length,
      pending: count("PENDING"),
      confirmed: count("CONFIRMED"),
      checkedIn: count("CHECKED_IN"),
      completed: count("COMPLETED"),
      cancelled: count("CANCELLED"),
      noShows: count("NO_SHOW"),
      openCancellationRequests: requestRows.length,
      roomsActive: roomCount,
      openBlocks: blockCount,
      newCustomersThisMonth: newCustomers,
    },
    money: {
      expectedTonight: revenueToday.expected,
      collected: revenueToday.collected,
      outstanding: Math.max(0, revenueToday.expected - revenueToday.collected),
      confirmedValue: amountOf("CONFIRMED") + amountOf("CHECKED_IN"),
      pipeline: amountOf("PENDING"),
    },
    occupancy: { percent: occupancy, bookedMinutes, capacityMinutes: roomCount * openNightMinutes },
    attention: attentionRows.map((row) => ({
      id: String(row._id),
      reference: row.reservationReference,
      date: row.reservationDate,
      startLabel: formatClubTime12h(row.startTime),
      roomName: row.room?.name ?? "—",
      guestName: row.customer?.fullName ?? "Guest",
      mobile: row.customer?.mobileNumber ?? "",
      minutesUntilStart: Math.round((new Date(row.startAt).getTime() - now.getTime()) / 60_000),
    })),
    requests: requestRows.map((row) => ({
      id: String(row._id),
      reference: row.reservationReference,
      date: row.reservationDate,
      startLabel: formatClubTime12h(row.startTime),
      roomName: row.room?.name ?? "—",
      reason: row.cancellationRequest?.reason ?? null,
    })),
    arrivals: todayRows
      .filter((row) => new Date(row.startAt).getTime() >= now.getTime() - 60 * 60_000)
      .slice(0, 6)
      .map((row) => ({
        id: String(row._id),
        reference: row.reservationReference,
        startLabel: formatClubTime12h(row.startTime),
        roomName: row.room?.name ?? "—",
        guestName: row.customer?.fullName ?? "Guest",
        guests: row.guestCount,
        status: row.status,
        amount: row.estimatedAmount,
      })),
    upcoming: upcomingRows.map((row) => ({
      id: String(row._id),
      reference: row.reservationReference,
      dateLabel: formatClubDateLong(row.reservationDate),
      startLabel: formatClubTime12h(row.startTime),
      roomName: row.room?.name ?? "—",
      status: row.status,
    })),
    series,
    health: system
      ? {
          database: system.database.connected ? "connected" : "down",
          latencyMs: system.database.latencyMs ?? null,
          collections: system.collections.length,
        }
      : { database: "unknown", latencyMs: null, collections: 0 },
  };
}

/** Booked/expected value for a single night, from reservations + payments. */
async function revenueForDates(_currency: string, date: string) {
  const reservations = await Reservation.find({
    reservationDate: date,
    status: { $in: ["PENDING", "CONFIRMED", "CHECKED_IN", "COMPLETED"] },
  })
    .select("estimatedAmount _id")
    .lean();

  const expected = reservations.reduce((sum, row) => sum + row.estimatedAmount, 0);
  const ids = reservations.map((row) => row._id);
  const paid = ids.length
    ? await Payment.aggregate<{ _id: null; total: number }>([
        { $match: { reservation: { $in: ids }, paymentStatus: { $in: ["PAID", "PARTIALLY_PAID"] } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ])
    : [];

  return { expected, collected: paid[0]?.total ?? 0 };
}

function operatingMinutes(openingTime: string, closingTime: string): number {
  const open = toMinutes(openingTime);
  const close = toMinutes(closingTime);
  return close <= open ? 1440 - open + close : close - open;
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function isWithinOperatingWindow(
  openingTime: string,
  closingTime: string,
  now: Date,
  timezone: string,
): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const clock = hour * 60 + minute;
  const open = toMinutes(openingTime);
  const close = toMinutes(closingTime);
  return close <= open ? clock >= open || clock < close : clock >= open && clock < close;
}
