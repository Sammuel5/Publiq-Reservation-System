import { connectToDatabase } from "@/lib/db/mongoose";
import { Reservation, Room, RoomBlock } from "@/lib/db/models";
import type { RoomDocument } from "@/lib/db/models/room";
import type { ClubSettingsView } from "@/lib/services/club-settings";
import { calculateReservationAmount } from "@/lib/utils/money";
import {
  addMinutes,
  addDaysToDateString,
  clubDateTimeToUtc,
  getClubNow,
  getClubWeekday,
  hhmmToMinutes,
  isDateString,
  minutesToHHMM,
} from "@/lib/utils/datetime";

/**
 * Availability engine (shared by the customer site and, from Phase 3, the admin
 * calendar).
 *
 * A room is unavailable for a window when ANY of these is true:
 *  1. it is inactive / not bookable / under maintenance,
 *  2. it has an overlapping CONFIRMED or CHECKED_IN reservation,
 *  3. it has an overlapping PENDING reservation whose hold has not expired,
 *  4. an admin RoomBlock overlaps (room-specific or venue-wide),
 *  5. the window leaves the club's operating hours,
 *  6. the window is in the past (or inside the minimum lead time),
 *  7. the booking is shorter than the room's minimum duration.
 *
 * All interval arithmetic happens on UTC instants (see lib/utils/datetime.ts),
 * so results are independent of the server's timezone.
 */

/** Customers may not book a slot that starts sooner than this. */
export const MIN_LEAD_MINUTES = 30;

/** Slot grid used for the customer-facing time picker. */
export const SLOT_GRID_MINUTES = 30;

/** How far ahead customers may book. */
export const MAX_ADVANCE_DAYS = 60;

export type RoomView = {
  id: string;
  slug: string;
  name: string;
  categorySlug: string;
  shortDescription: string | null;
  description: string | null;
  capacity: number;
  hourlyRate: number;
  minimumDuration: number;
  slotMinutes: number;
  amenities: string[];
  images: string[];
  coverImage: string | null;
  isBookable: boolean;
  maintenanceStatus: string;
};

export type Interval = { startAt: Date; endAt: Date };

export type OperatingWindow = {
  isOpen: boolean;
  /** Why the club is closed, when `isOpen` is false. */
  reason: string | null;
  opensAt: Date;
  closesAt: Date;
  openingTime: string;
  closingTime: string;
};

export type SlotOption = {
  time: string;
  endTime: string;
  available: boolean;
  roomsAvailable: number;
};

export type RoomAvailability = {
  room: RoomView;
  available: boolean;
  /** Machine-readable reason when unavailable. */
  code:
    | "AVAILABLE"
    | "MIN_DURATION"
    | "CAPACITY"
    | "ROOM_UNAVAILABLE"
    | "CONFLICT"
    | "BLOCKED"
    | "CLOSED_HOURS"
    | "PAST";
  message: string | null;
  estimatedAmount: number;
};

export type AvailabilityContext = {
  date: string;
  timezone: string;
  now: Date;
  window: OperatingWindow;
  rooms: RoomView[];
  /** Reservation intervals per room id (string). */
  intervalsByRoom: Map<string, Interval[]>;
  /** Venue-wide blocks (room === null). */
  venueBlocks: Interval[];
};

function toRoomView(room: RoomDocument & { _id: unknown }): RoomView {
  const maintenanceOk = room.maintenanceStatus === "OPERATIONAL";
  return {
    id: String(room._id),
    slug: room.slug,
    name: room.name,
    categorySlug: room.categorySlug,
    shortDescription: room.shortDescription ?? null,
    description: room.description ?? null,
    capacity: room.capacity,
    hourlyRate: room.hourlyRate,
    minimumDuration: room.minimumDuration ?? 60,
    slotMinutes: room.slotMinutes ?? SLOT_GRID_MINUTES,
    amenities: room.amenities ?? [],
    images: room.images ?? [],
    coverImage: room.coverImage ?? null,
    isBookable: room.isActive === true && room.isAvailable === true && maintenanceOk,
    maintenanceStatus: room.maintenanceStatus,
  };
}

/**
 * Operating window for a business date.
 * Closing time <= opening time means the club closes after midnight, so the
 * window ends on the following calendar day.
 */
export function getOperatingWindow(
  settings: Pick<
    ClubSettingsView,
    "operatingDays" | "openingTime" | "closingTime" | "timezone"
  >,
  date: string,
): OperatingWindow {
  const opensAt = clubDateTimeToUtc(date, settings.openingTime, settings.timezone);

  // Closing time at or before opening time means the club trades past midnight,
  // so the window ends on the following calendar day.
  const overnight =
    hhmmToMinutes(settings.closingTime) <= hhmmToMinutes(settings.openingTime);
  const closeDate = overnight ? addDaysToDateString(date, 1) : date;
  const closesAt = clubDateTimeToUtc(closeDate, settings.closingTime, settings.timezone);

  const weekday = getClubWeekday(opensAt, settings.timezone);
  const isOperatingDay = (settings.operatingDays ?? []).includes(weekday);

  return {
    isOpen: isOperatingDay,
    reason: isOperatingDay ? null : "The club is closed on this day.",
    opensAt,
    closesAt,
    openingTime: settings.openingTime,
    closingTime: settings.closingTime,
  };
}

/** All bookable rooms (active, available, not under maintenance). */
export async function listBookableRooms(): Promise<RoomView[]> {
  await connectToDatabase();
  const rooms = await Room.find({
    isActive: true,
    isAvailable: true,
    maintenanceStatus: "OPERATIONAL",
  })
    .sort({ sortOrder: 1, hourlyRate: 1 })
    .lean<Array<RoomDocument & { _id: unknown }>>();
  return rooms.map(toRoomView);
}

/** Every room regardless of state — used to explain why one cannot be booked. */
export async function listAllRooms(): Promise<RoomView[]> {
  await connectToDatabase();
  const rooms = await Room.find({}).sort({ sortOrder: 1, hourlyRate: 1 }).lean<
    Array<RoomDocument & { _id: unknown }>
  >();
  return rooms.map(toRoomView);
}

export async function getRoomBySlug(slug: string): Promise<RoomView | null> {
  await connectToDatabase();
  const room = await Room.findOne({ slug: slug.toLowerCase() }).lean<
    (RoomDocument & { _id: unknown }) | null
  >();
  return room ? toRoomView(room) : null;
}

/** Blocking intervals for every room on a business date. */
export async function loadAvailabilityContext(
  settings: ClubSettingsView,
  date: string,
  /**
   * `excludeReservationId` lets the admin console ask "is this window free for
   * everybody *except* this booking?" — required when staff move an existing
   * reservation, which would otherwise collide with itself.
   */
  options: { now?: Date; excludeReservationId?: string } = {},
): Promise<AvailabilityContext> {
  if (!isDateString(date)) throw new Error("Invalid date");

  await connectToDatabase();

  const now = options.now ?? new Date();
  const window = getOperatingWindow(settings, date);

  const dayStart = window.opensAt;
  const dayEnd = window.closesAt;

  const [rooms, reservations, blocks] = await Promise.all([
    listAllRooms(),
    Reservation.find({
      ...(options.excludeReservationId ? { _id: { $ne: options.excludeReservationId } } : {}),
      // Only statuses that actually hold the room are considered.
      status: { $in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
      startAt: { $lt: dayEnd },
      endAt: { $gt: dayStart },
      // A pending hold stops blocking the moment it expires (Phase 4 sweeps it
      // into EXPIRED; until then this filter is authoritative).
      $or: [
        { status: { $in: ["CONFIRMED", "CHECKED_IN"] } },
        { status: "PENDING", pendingExpiresAt: { $gt: now } },
        { status: "PENDING", pendingExpiresAt: null },
      ],
    })
      .select("room startAt endAt")
      .lean<Array<{ room: unknown; startAt: Date; endAt: Date }>>(),
    RoomBlock.find({
      isActive: true,
      startAt: { $lt: dayEnd },
      endAt: { $gt: dayStart },
    })
      .select("room startAt endAt")
      .lean<Array<{ room: unknown | null; startAt: Date; endAt: Date }>>(),
  ]);

  const intervalsByRoom = new Map<string, Interval[]>();
  for (const reservation of reservations) {
    const key = String(reservation.room);
    const list = intervalsByRoom.get(key) ?? [];
    list.push({ startAt: reservation.startAt, endAt: reservation.endAt });
    intervalsByRoom.set(key, list);
  }

  const venueBlocks: Interval[] = [];
  for (const block of blocks) {
    const interval = { startAt: block.startAt, endAt: block.endAt };
    if (!block.room) {
      venueBlocks.push(interval);
      continue;
    }
    const key = String(block.room);
    const list = intervalsByRoom.get(key) ?? [];
    list.push(interval);
    intervalsByRoom.set(key, list);
  }

  return {
    date,
    timezone: settings.timezone,
    now,
    window,
    rooms,
    intervalsByRoom,
    venueBlocks,
  };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/**
 * Start times on the 30-minute grid that fit inside the operating window.
 *
 * The grid is generated in CLUB-LOCAL time (so "14:00" always means 2pm at the
 * club), then each boundary is converted to a UTC instant for comparison.
 */
export function buildSlotGrid(
  window: OperatingWindow,
  date: string,
  timezone: string,
  durationMinutes: number,
): Array<{ time: string; endTime: string; startAt: Date; endAt: Date }> {
  const slots: Array<{ time: string; endTime: string; startAt: Date; endAt: Date }> = [];
  if (!window.isOpen) return slots;

  const windowMinutes = Math.round(
    (window.closesAt.getTime() - window.opensAt.getTime()) / 60_000,
  );
  const openMinutes = hhmmToMinutes(window.openingTime);

  for (let offset = 0; offset + durationMinutes <= windowMinutes; offset += SLOT_GRID_MINUTES) {
    const localStart = openMinutes + offset;
    const startDayOffset = Math.floor(localStart / 1440);
    const startHHMM = minutesToHHMM(localStart % 1440);

    const localEnd = localStart + durationMinutes;
    const endHHMM = minutesToHHMM(localEnd % 1440);

    const startAt = clubDateTimeToUtc(
      addDaysToDateString(date, startDayOffset),
      startHHMM,
      timezone,
    );

    slots.push({
      time: startHHMM,
      endTime: endHHMM,
      startAt,
      endAt: addMinutes(startAt, durationMinutes),
    });
  }

  return slots;
}

/** Room-agnostic slot list for the wizard's time picker. */
export function computeDaySlots(
  context: AvailabilityContext,
  durationMinutes: number,
): { slots: SlotOption[]; closed: boolean; reason: string | null } {
  if (!context.window.isOpen) {
    return { slots: [], closed: true, reason: context.window.reason };
  }

  const earliest = context.now.getTime() + MIN_LEAD_MINUTES * 60_000;

  const slots = buildSlotGrid(context.window, context.date, context.timezone, durationMinutes).map((slot) => {
    let roomsAvailable = 0;

    if (slot.startAt.getTime() >= earliest) {
      for (const room of context.rooms) {
        if (!room.isBookable) continue;
        if (room.capacity < 1) continue;
        if (durationMinutes < room.minimumDuration) continue;

        const conflicts = context.intervalsByRoom.get(room.id) ?? [];
        const blockedByVenue = context.venueBlocks.some((block) =>
          overlaps(slot.startAt, slot.endAt, block.startAt, block.endAt),
        );
        if (blockedByVenue) continue;

        const busy = conflicts.some((interval) =>
          overlaps(slot.startAt, slot.endAt, interval.startAt, interval.endAt),
        );
        if (!busy) roomsAvailable += 1;
      }
    }

    return {
      time: slot.time,
      endTime: slot.endTime,
      available: roomsAvailable > 0,
      roomsAvailable,
    };
  });

  return { slots, closed: false, reason: null };
}

/** Per-room availability for a specific start time + duration. */
export function computeRoomAvailability(
  context: AvailabilityContext,
  startTime: string,
  durationMinutes: number,
  guestCount?: number,
): RoomAvailability[] {
  const startAt = clubDateTimeToUtc(context.date, startTime, context.timezone);
  const endAt = addMinutes(startAt, durationMinutes);
  const earliest = context.now.getTime() + MIN_LEAD_MINUTES * 60_000;

  return context.rooms.map((room) => {
    const estimatedAmount = calculateReservationAmount(room.hourlyRate, durationMinutes);
    const base = { room, estimatedAmount };

    if (!room.isBookable) {
      return {
        ...base,
        available: false,
        code: "ROOM_UNAVAILABLE" as const,
        message:
          room.maintenanceStatus !== "OPERATIONAL"
            ? "Under maintenance"
            : "Not available for booking",
      };
    }

    if (guestCount !== undefined && guestCount > room.capacity) {
      return {
        ...base,
        available: false,
        code: "CAPACITY" as const,
        message: `Fits up to ${room.capacity} guests`,
      };
    }

    if (durationMinutes < room.minimumDuration) {
      return {
        ...base,
        available: false,
        code: "MIN_DURATION" as const,
        message: `Minimum ${room.minimumDuration} minutes`,
      };
    }

    if (startAt.getTime() < context.window.opensAt.getTime() || endAt.getTime() > context.window.closesAt.getTime()) {
      return {
        ...base,
        available: false,
        code: "CLOSED_HOURS" as const,
        message: "Outside operating hours",
      };
    }

    if (startAt.getTime() < earliest) {
      return {
        ...base,
        available: false,
        code: "PAST" as const,
        message: "Too soon to book",
      };
    }

    if (context.venueBlocks.some((block) => overlaps(startAt, endAt, block.startAt, block.endAt))) {
      return { ...base, available: false, code: "BLOCKED" as const, message: "Blocked by the club" };
    }

    const conflicts = context.intervalsByRoom.get(room.id) ?? [];
    if (conflicts.some((interval) => overlaps(startAt, endAt, interval.startAt, interval.endAt))) {
      return {
        ...base,
        available: false,
        code: "CONFLICT" as const,
        message: "Already reserved for this time",
      };
    }

    return { ...base, available: true, code: "AVAILABLE" as const, message: null };
  });
}

/**
 * Is this exact window free for this room? Authoritative server check used at
 * submission time (the client's view is advisory only).
 */
export async function isRoomWindowFree(params: {
  settings: ClubSettingsView;
  roomId: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  now?: Date;
}): Promise<{ free: boolean; code: RoomAvailability["code"]; message: string | null }> {
  const context = await loadAvailabilityContext(params.settings, params.date, {
    now: params.now,
  });
  const results = computeRoomAvailability(
    context,
    params.startTime,
    params.durationMinutes,
  );
  const target = results.find((entry) => entry.room.id === params.roomId);

  if (!target) {
    return { free: false, code: "ROOM_UNAVAILABLE", message: "Room not found" };
  }
  return { free: target.available, code: target.code, message: target.message };
}

/** First N bookable start times for a room on a date (used on room pages). */
export function nextAvailableSlots(
  context: AvailabilityContext,
  roomId: string,
  durationMinutes: number,
  limit = 4,
): string[] {
  const { slots } = computeDaySlots(context, durationMinutes);
  const room = context.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return [];

  const available: string[] = [];
  for (const slot of slots) {
    if (available.length >= limit) break;
    if (!slot.available) continue;

    const startAt = clubDateTimeToUtc(context.date, slot.time, context.timezone);
    const endAt = addMinutes(startAt, durationMinutes);
    const busy = (context.intervalsByRoom.get(roomId) ?? []).some((interval) =>
      overlaps(startAt, endAt, interval.startAt, interval.endAt),
    );
    const blocked = context.venueBlocks.some((block) =>
      overlaps(startAt, endAt, block.startAt, block.endAt),
    );
    if (!busy && !blocked && startAt.getTime() >= context.now.getTime() + MIN_LEAD_MINUTES * 60_000) {
      available.push(slot.time);
    }
  }
  return available;
}

/** Today's business date in club time. */
export function todayInClubTime(settings: Pick<ClubSettingsView, "timezone">): string {
  return getClubNow(new Date(), settings.timezone).date;
}

export function maxBookingDate(settings: Pick<ClubSettingsView, "timezone">): string {
  return addDaysToDateString(todayInClubTime(settings), MAX_ADVANCE_DAYS);
}
