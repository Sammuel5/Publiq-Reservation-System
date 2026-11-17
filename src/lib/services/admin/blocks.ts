import { Types } from "mongoose";
import { Reservation, Room, RoomBlock } from "@/lib/db/models";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getClubSettings } from "@/lib/services/club-settings";
import { todayInClubTime } from "@/lib/services/availability";
import { roomBlockQuerySchema, roomBlockCreateSchema } from "@/lib/validation/admin";
import {
  addDaysToDateString,
  addMinutes,
  clubDateTimeToUtc,
  formatClubDateLong,
  formatClubTime12h,
  hhmmToMinutes,
} from "@/lib/utils/datetime";
import { blankToNull, sanitizeText } from "@/lib/utils/normalize";
import type { Actor } from "@/lib/services/admin/shared";

/**
 * Blocked dates and maintenance windows.
 *
 * A block is a range of UTC instants, optionally attached to one room; with no
 * room it closes the whole venue. Blocks are what the availability engine
 * already respects (`loadAvailabilityContext` folds them into the same interval
 * map as bookings), so creating one here immediately changes the public site.
 *
 * Two deliberate choices:
 * - Blocks are **soft-deleted** (`isActive: false`). The audit value of "we
 *   closed the club on 24 December" outlives the convenience of a clean table.
 * - Overlapping an existing booking is a **warning the admin must acknowledge**
 *   (`force: true`), never a silent overwrite. Blocking a room while a party is
 *   booked is a real thing that happens (a private event takes the floor); the
 *   console should make it a conscious act and say who did it.
 */

export type AdminBlock = {
  id: string;
  roomId: string | null;
  roomName: string;
  scope: "VENUE" | "ROOM";
  date: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  startLabel: string;
  endLabel: string;
  reason: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  overlaps: { reservations: number; references: string[] };
};

export async function listBlocks(raw: unknown): Promise<{ blocks: AdminBlock[]; today: string; window: { from: string; to: string } }> {
  const parsed = roomBlockQuerySchema.safeParse(asObject(raw));
  const query = parsed.success ? parsed.data : { from: undefined, to: undefined, room: null };
  const club = await getClubSettings();
  const today = todayInClubTime(club);

  const from = query.from ?? addDaysToDateString(today, -7);
  const to = query.to ?? addDaysToDateString(today, 30);
  const windowStart = clubDateTimeToUtc(from, "00:00", club.timezone);
  const windowEnd = clubDateTimeToUtc(addDaysToDateString(to, 1), "00:00", club.timezone);

  const filter: Record<string, unknown> = {
    startAt: { $lt: windowEnd },
    endAt: { $gt: windowStart },
  };
  if (query.room) filter.room = query.room;

  const [docs, rooms] = await Promise.all([
    RoomBlock.find(filter)
      .sort({ startAt: 1 })
      .populate<{ createdBy: { name: string } | null }>("createdBy", "name")
      .lean(),
    Room.find({}).select("name").lean(),
  ]);
  const roomNames = new Map(rooms.map((room) => [String(room._id), room.name]));

  const blocks = await Promise.all(
    docs.map(async (doc) => {
      const overlapFilter: Record<string, unknown> = {
        status: { $in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
        startAt: { $lt: new Date(doc.endAt) },
        endAt: { $gt: new Date(doc.startAt) },
      };
      if (doc.room) overlapFilter.room = doc.room;
      const overlapping = await Reservation.find(overlapFilter)
        .select("reservationReference")
        .sort({ startAt: 1 })
        .limit(6)
        .lean();

      const startAt = new Date(doc.startAt);
      const endAt = new Date(doc.endAt);
      const startDate = startAt.toLocaleDateString("en-CA", { timeZone: club.timezone });
      const endDate = endAt.toLocaleDateString("en-CA", { timeZone: club.timezone });
      const startTime = startAt.toLocaleTimeString("en-GB", { timeZone: club.timezone, hour: "2-digit", minute: "2-digit" });
      const endTime = endAt.toLocaleTimeString("en-GB", { timeZone: club.timezone, hour: "2-digit", minute: "2-digit" });

      return {
        id: String(doc._id),
        roomId: doc.room ? String(doc.room) : null,
        roomName: doc.room ? (roomNames.get(String(doc.room)) ?? "Room removed") : "Whole venue",
        scope: (doc.room ? "ROOM" : "VENUE") as AdminBlock["scope"],
        date: startDate,
        startDate,
        endDate,
        startTime,
        endTime,
        startLabel: `${formatClubDateLong(startDate)} · ${formatClubTime12h(startTime)}`,
        endLabel: `${formatClubDateLong(endDate)} · ${formatClubTime12h(endTime)}`,
        reason: doc.reason ?? null,
        isActive: doc.isActive,
        createdBy: doc.createdBy?.name ?? null,
        createdAt: new Date(doc.createdAt).toISOString(),
        overlaps: {
          reservations: overlapping.length,
          references: overlapping.map((row) => row.reservationReference),
        },
      } satisfies AdminBlock;
    }),
  );

  return { blocks, today, window: { from, to } };
}

export async function createBlock(raw: unknown, actor: Actor): Promise<{ id: string; warning: string | null }> {
  const parsed = roomBlockCreateSchema.safeParse(asObject(raw));
  if (!parsed.success) {
    throw new ValidationError("Some fields need your attention.", {
      fields: firstIssueFields(parsed.error.issues),
    });
  }
  const club = await getClubSettings();
  const input = parsed.data;

  const startAt = clubDateTimeToUtc(input.date, input.startTime, club.timezone);
  let endAt = clubDateTimeToUtc(input.date, input.endTime, club.timezone);
  // A window that ends before it starts is an overnight block, not a typo.
  if (endAt.getTime() <= startAt.getTime()) {
    endAt = addMinutes(endAt, 1440);
  }
  if (endAt.getTime() - startAt.getTime() > 1000 * 60 * 60 * 24 * 31) {
    throw new ValidationError("Blocks are limited to 31 days. Create several shorter windows instead.", {
      fields: { endTime: "That window is longer than 31 days." },
    });
  }

  const roomId = input.roomId ? new Types.ObjectId(input.roomId) : null;
  if (roomId && !(await Room.exists({ _id: roomId }))) {
    throw new ValidationError("Choose a room that exists, or block the whole venue.", {
      fields: { roomId: "Unknown room." },
    });
  }

  const overlapFilter: Record<string, unknown> = {
    status: { $in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  };
  if (roomId) overlapFilter.room = roomId;
  const conflicts = await Reservation.find(overlapFilter)
    .select("reservationReference startTime endTime")
    .sort({ startAt: 1 })
    .limit(25)
    .lean();

  let warning: string | null = null;
  if (conflicts.length > 0) {
    const references = conflicts.map((doc) => doc.reservationReference).join(", ");
    if (!input.force) {
      throw new ValidationError(
        `${conflicts.length} live booking${conflicts.length === 1 ? "" : "s"} overlap this window (${references}). Move them, or tick "block anyway" to close the window regardless.`,
        { conflicts: conflicts.map((doc) => ({ reference: doc.reservationReference })), fields: { force: "Confirm you still want to block this window." } },
      );
    }
    warning = `Blocked anyway — ${conflicts.length} booking${conflicts.length === 1 ? "" : "s"} still stand: ${references}.`;
  }

  const doc = await RoomBlock.create({
    room: roomId,
    startAt,
    endAt,
    reason: blankToNull(sanitizeText(input.reason ?? "")) ?? (roomId ? "Room blocked by staff" : "Venue closed by staff"),
    createdBy: actor.id,
  });

  logger.info("admin.blocks.create", "Room block created", {
    room: roomId ? String(roomId) : "venue",
    forced: conflicts.length > 0,
    actor: actor.email,
  });

  return { id: String(doc._id), warning };
}

export async function closeBlock(id: string, actor: Actor): Promise<{ ok: true }> {
  const updated = await RoomBlock.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: { isActive: false, closedBy: actor.id, closedAt: new Date() } },
    { new: true },
  ).lean();
  if (!updated) throw new NotFoundError("That block is already closed or no longer exists.");
  logger.info("admin.blocks.close", "Room block deactivated", { id, actor: actor.email });
  return { ok: true };
}

export async function reopenBlock(id: string, actor: Actor): Promise<{ ok: true }> {
  // Reopening clears the closure stamp: the row should describe the window's
  // current state, with the previous closure left in the log.
  const updated = await RoomBlock.findOneAndUpdate(
    { _id: id, isActive: false },
    { $set: { isActive: true }, $unset: { closedBy: 1, closedAt: 1 } },
    { new: true },
  ).lean();
  if (!updated) throw new NotFoundError("That block is already open or no longer exists.");
  logger.info("admin.blocks.reopen", "Room block reactivated", { id, actor: actor.email });
  return { ok: true };
}

/**
 * Maintenance status is a room-level flag the public site reads. This helper is
 * what the "Take room offline" button calls, so the flag and a matching block
 * window stay in sync.
 */
export async function setRoomMaintenance(
  roomId: string,
  status: "OPERATIONAL" | "SCHEDULED" | "IN_PROGRESS",
  note: string | null,
  actor: Actor,
): Promise<{ ok: true }> {
  const room = await Room.findByIdAndUpdate(
    roomId,
    { $set: { maintenanceStatus: status, maintenanceNote: blankToNull(note ?? "") } },
    { new: true },
  ).lean();
  if (!room) throw new NotFoundError("That room no longer exists.");
  logger.info("admin.rooms.maintenance", "Room maintenance status changed", {
    room: room.slug,
    status,
    actor: actor.email,
  });
  return { ok: true };
}

/** Hours that a night's blocks consume, for the rooms table. */
export function blockedMinutesForNight(blocks: AdminBlock[], date: string, roomId: string, openingTime: string, closingTime: string): number {
  const open = hhmmToMinutes(openingTime);
  const night = closingTime <= openingTime ? 1440 - open + hhmmToMinutes(closingTime) : hhmmToMinutes(closingTime) - open;
  let minutes = 0;
  for (const block of blocks) {
    if (block.isActive && (block.roomId === null || block.roomId === roomId) && block.date === date) {
      minutes += Math.min(night, hhmmToMinutes(block.endTime) - hhmmToMinutes(block.startTime));
    }
  }
  return Math.max(0, minutes);
}

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function firstIssueFields(issues: Array<{ path: (string | number)[]; message: string }>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_form";
    if (fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}
