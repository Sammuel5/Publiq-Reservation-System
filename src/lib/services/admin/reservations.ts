import { bookingNotifications } from "@/lib/services/notifications";
import mongoose, { Types, type FilterQuery } from "mongoose";
import { connectToDatabase } from "@/lib/db/mongoose";
import {
  AdminUser,
  Customer,
  Payment,
  Reservation,
  Room,
  RoomBlock,
  RoomSlotLock,
  type ReservationStatus,
} from "@/lib/db/models";
import type { ReservationDocument } from "@/lib/db/models/reservation";
import { getClubSettings, type ClubSettingsView } from "@/lib/services/club-settings";
import {
  MAX_ADVANCE_DAYS,
  computeRoomAvailability,
  loadAvailabilityContext,
  todayInClubTime,
} from "@/lib/services/availability";
import { createWithUniqueReference } from "@/lib/services/reservation-reference";
import {
  buildSubmissionKey,
  conflictMessageFor,
  createReservation,
  type PublicReservation,
} from "@/lib/services/reservations";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isDuplicateKeyError } from "@/lib/errors";
import { PERMISSIONS, roleHasPermission, type AdminRole, type Permission } from "@/config/app";
import { logger } from "@/lib/logger";
import {
  addDaysToDateString,
  addMinutes,
  clubDateTimeToUtc,
  formatClubDateLong,
  formatClubTime12h,
  hhmmToMinutes,
  minutesToHHMM,
} from "@/lib/utils/datetime";
import { calculateReservationAmount } from "@/lib/utils/money";
import {
  blankToNull,
  formatMobileNumber,
  normalizeEmail,
  normalizeMobileNumber,
  normalizePersonName,
  sanitizeText,
} from "@/lib/utils/normalize";
import {
  containsRegex,
  escapeRegex,
  paginate,
  pageSkip,
  type Actor,
  type Paged,
} from "@/lib/services/admin/shared";
import {
  reservationQuerySchema,
  type ReservationActionInput,
  type ReservationEditInput,
  type ReservationMoveInput,
} from "@/lib/validation/admin";

/**
 * Admin reservation service (Phase 3).
 *
 * Design rules this file exists to enforce:
 *
 * 1. **Every state change is a guarded transition, never a free-form edit.**
 *    The update carries the allowed `from` statuses inside the query filter, so
 *    two staff members clicking "Confirm" at the same moment cannot both
 *    succeed — the loser re-reads the row and gets a 409.
 * 2. **Slot locks are kept in step with status.** Confirming promotes them, any
 *    terminal status deletes them, so the room becomes bookable again without
 *    waiting for a cron job.
 * 3. **The audit trail is written by the same update**, with `changedBy` set to
 *    the acting admin. Nothing in the console mutates a reservation silently.
 * 4. **Money is recalculated, never typed in.** Editing or moving a booking
 *    re-prices it from the room's current hourly rate.
 */

// --------------------------------------------------------------- transitions --

export type AdminAction = ReservationActionInput["action"];

type Transition = {
  from: ReservationStatus[];
  to: ReservationStatus;
  /** Slots stop being held for these outcomes. */
  releasesLocks: boolean;
  label: string;
};

export const RESERVATION_TRANSITIONS: Record<AdminAction, Transition> = {
  CONFIRM: {
    from: ["PENDING"],
    to: "CONFIRMED",
    releasesLocks: false,
    label: "Confirmed",
  },
  REJECT: {
    from: ["PENDING"],
    to: "REJECTED",
    releasesLocks: true,
    label: "Rejected",
  },
  CHECK_IN: {
    from: ["PENDING", "CONFIRMED"],
    to: "CHECKED_IN",
    releasesLocks: false,
    label: "Checked in",
  },
  COMPLETE: {
    from: ["CHECKED_IN", "CONFIRMED"],
    to: "COMPLETED",
    releasesLocks: true,
    label: "Completed",
  },
  NO_SHOW: {
    from: ["PENDING", "CONFIRMED"],
    to: "NO_SHOW",
    releasesLocks: true,
    label: "Marked no-show",
  },
  CANCEL: {
    from: ["PENDING", "CONFIRMED", "CHECKED_IN"],
    to: "CANCELLED",
    releasesLocks: true,
    label: "Cancelled",
  },
  EXPIRE: {
    from: ["PENDING"],
    to: "EXPIRED",
    releasesLocks: true,
    label: "Expired",
  },
};

const LIVE_STATUSES: ReservationStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN"];

export type ReservationRow = {
  id: string;
  reference: string;
  status: ReservationStatus;
  source: "CUSTOMER" | "ADMIN";
  date: string;
  dateLabel: string;
  startTime: string;
  endTime: string;
  startLabel: string;
  endLabel: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  guestCount: number;
  roomName: string;
  roomSlug: string;
  roomCapacity: number;
  customerName: string;
  customerMobile: string;
  customerEmail: string | null;
  amount: number;
  currency: string;
  minutesUntilStart: number;
  isToday: boolean;
  isPast: boolean;
  overCapacity: boolean;
  pendingRequest: "NONE" | "PENDING" | "APPROVED" | "DECLINED";
  needsAttention: boolean;
  attentionReason: string | null;
  specialRequests: string | null;
  createdAt: string;
};

export type ReservationBoard = {
  page: Paged<ReservationRow>;
  window: { from: string; to: string; view: "today" | "upcoming" | "all" };
  counts: { status: Record<string, number>; total: number; attention: number };
  money: { expected: number; collected: number; outstanding: number; currency: string };
  rooms: Array<{ id: string; name: string }>;
  today: string;
};

// --------------------------------------------------------------------- board --

type ReservationFilter = FilterQuery<ReservationDocument>;

function buildDateFilter(query: {
  view: "today" | "upcoming" | "all";
  from?: string;
  to?: string;
  today: string;
}): ReservationFilter {
  if (query.view === "today") return { reservationDate: query.today };
  if (query.view === "upcoming") return { reservationDate: { $gte: query.today } };
  if (query.from || query.to) {
    const from = query.from ?? query.to!;
    const to = query.to ?? addDaysToDateString(from, 30);
    return { reservationDate: { $gte: from, $lte: to } };
  }
  // "all" with no dates: the last fortnight through the booking horizon, so the
  // board never turns into a full-collection scan.
  return {
    reservationDate: {
      $gte: addDaysToDateString(query.today, -14),
      $lte: addDaysToDateString(query.today, MAX_ADVANCE_DAYS),
    },
  };
}

function statusFilter(statuses: string[]): ReservationFilter {
  if (statuses.length === 0) return {};
  if (statuses.includes("ALL")) return {};
  const plain = statuses.filter((status) => status !== "ATTENTION");
  const parts: ReservationFilter[] = [];
  if (plain.length > 0) parts.push({ status: { $in: plain } });
  if (statuses.includes("ATTENTION")) {
    parts.push({ "cancellationRequest.status": "PENDING" });
    if (plain.length === 0) parts.push({ status: "PENDING" });
  }
  return (parts.length === 1 ? parts[0]! : { $or: parts }) as ReservationFilter;
}

export async function listReservations(
  raw: unknown,
  settings?: ClubSettingsView,
): Promise<ReservationBoard> {
  const club = settings ?? (await getClubSettings());
  const parsed = reservationQuerySchema.safeParse(
    typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {},
  );
  // A hand-typed bad query string should show the default board, never a 500.
  const query = parsed.success ? parsed.data : reservationQuerySchema.parse({});
  const today = todayInClubTime(club);
  const now = new Date();

  const base: ReservationFilter = { ...buildDateFilter({ ...query, today }) };
  const statuses = statusFilter(query.status);
  const filter: ReservationFilter = { ...base, ...statuses };

  if (query.room) filter.room = query.room;
  if (query.source) filter.source = query.source;
  if (query.q) {
    const term = query.q;
    const reference = term.toUpperCase().replace(/\s+/g, "");
    const mobile = normalizeMobileNumber(term);
    filter.$or = [
      { reservationReference: { $regex: `^${escapeRegex(reference)}`, $options: "i" } },
      ...(mobile ? [{ customer: await customersWithMobile(mobile) }] : []),
      { customer: await customersMatching(term) },
    ];
  }

  const sortField = query.sort === "amount" ? "estimatedAmount" : query.sort;
  const sort = { [sortField]: query.dir === "desc" ? -1 : 1, startTime: 1 } as Record<string, 1 | -1>;

  const [docs, total, roomList] = await Promise.all([
    Reservation.find(filter)
      .sort(sort)
      .skip(pageSkip(query.page, query.perPage))
      .limit(query.perPage)
      .populate<{ customer: { fullName: string; mobileNumber: string; email: string | null } | null }>(
        "customer",
        "fullName mobileNumber email",
      )
      .populate<{ room: { name: string; slug: string; capacity: number } | null }>(
        "room",
        "name slug capacity",
      )
      .lean(),
    Reservation.countDocuments(filter),
    Room.find({}).sort({ sortOrder: 1, name: 1 }).select("name").lean(),
  ]);

  const rows = docs.map((doc) =>
    toRow(doc as unknown as ReservationDocLike, today, now),
  );

  // Facet counts are computed for the same date window, ignoring the status
  // filter, so the tab strip shows what each tab would contain.
  const counts = await countByStatus({ ...base, ...(query.room ? { room: query.room } : {}) });

  const money = await moneyForRows(rows, now);

  return {
    page: paginate(rows, total, query.page, query.perPage),
    window: {
      from: query.from ?? (query.view === "all" ? addDaysToDateString(today, -14) : today),
      to: query.to ?? (query.view === "today" ? today : addDaysToDateString(today, MAX_ADVANCE_DAYS)),
      view: query.view,
    },
    counts: { ...counts, attention: rows.filter((row) => row.needsAttention).length },
    money,
    rooms: roomList.map((room) => ({ id: String(room._id), name: room.name })),
    today,
  };
}

async function customersWithMobile(mobile: string): Promise<{ $in: unknown[] }> {
  const ids = await Customer.find({ mobileNumber: mobile }).select("_id").lean();
  return { $in: ids.map((doc) => doc._id) };
}

async function customersMatching(term: string): Promise<{ $in: unknown[] }> {
  const ids = await Customer.find({
    $or: [{ fullName: containsRegex(term) }, { mobileNumber: containsRegex(term) }],
  })
    .select("_id")
    .lean();
  return { $in: ids.map((doc) => doc._id) };
}

async function countByStatus(base: ReservationFilter) {
  const grouped = await Reservation.aggregate<{ _id: string; count: number }>([
    { $match: base },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const status: Record<string, number> = {};
  let total = 0;
  for (const row of grouped) {
    status[row._id] = row.count;
    total += row.count;
  }
  return { status, total };
}

async function moneyForRows(rows: ReservationRow[], now: Date) {
  if (rows.length === 0) {
    return { expected: 0, collected: 0, outstanding: 0, currency: "PHP" };
  }
  const ids = rows.map((row) => new Types.ObjectId(row.id));
  const payments = await Payment.aggregate<{ _id: string; total: number }>([
    { $match: { reservation: { $in: ids }, paymentStatus: { $in: ["PAID", "PARTIALLY_PAID"] } } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const collected = payments[0]?.total ?? 0;
  const expected = rows.reduce((sum, row) => sum + row.amount, 0);
  void now;
  return {
    expected,
    collected,
    outstanding: Math.max(0, expected - collected),
    currency: rows[0]?.currency ?? "PHP",
  };
}

type ReservationDocLike = {
  _id: unknown;
  reservationReference: string;
  status: ReservationStatus;
  source: "CUSTOMER" | "ADMIN";
  reservationDate: string;
  startTime: string;
  endTime: string;
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  guestCount: number;
  estimatedAmount: number;
  currency: string;
  specialRequests?: string | null;
  createdAt?: Date;
  cancellationRequest?: { status: "NONE" | "PENDING" | "APPROVED" | "DECLINED" };
  customer?: { fullName: string; mobileNumber: string; email?: string | null } | null;
  room?: { name: string; slug: string; capacity: number } | null;
};

function toRow(doc: ReservationDocLike, today: string, now: Date): ReservationRow {
  const startAt = new Date(doc.startAt);
  const endAt = new Date(doc.endAt);
  const isToday = doc.reservationDate === today;
  const isPast = endAt.getTime() <= now.getTime();
  const capacity = doc.room?.capacity ?? 0;
  const overCapacity = capacity > 0 && doc.guestCount > capacity;

  const request = doc.cancellationRequest?.status ?? "NONE";
  let attentionReason: string | null = null;
  if (request === "PENDING") attentionReason = "Customer asked to cancel — needs a decision";
  else if (doc.status === "PENDING" && startAt.getTime() - now.getTime() < 2 * 60 * 60 * 1000)
    attentionReason = "Still unconfirmed less than 2 hours before start";
  else if (doc.status === "PENDING" && startAt.getTime() <= now.getTime())
    attentionReason = "Started while still pending — confirm, check in or release it";
  else if (doc.status === "CHECKED_IN" && isPast)
    attentionReason = "Guest has checked out of the window — mark completed";
  else if (overCapacity) attentionReason = "Party is larger than this room's capacity";

  return {
    id: String(doc._id),
    reference: doc.reservationReference,
    status: doc.status,
    source: doc.source,
    date: doc.reservationDate,
    dateLabel: formatClubDateLong(doc.reservationDate),
    startTime: doc.startTime,
    endTime: doc.endTime,
    startLabel: formatClubTime12h(doc.startTime),
    endLabel: formatClubTime12h(doc.endTime),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    durationMinutes: doc.durationMinutes,
    guestCount: doc.guestCount,
    roomName: doc.room?.name ?? "Room removed",
    roomSlug: doc.room?.slug ?? "",
    roomCapacity: capacity,
    customerName: doc.customer?.fullName ?? "Unknown guest",
    customerMobile: doc.customer?.mobileNumber ? formatMobileNumber(doc.customer.mobileNumber) : "—",
    customerEmail: doc.customer?.email ?? null,
    amount: doc.estimatedAmount,
    currency: doc.currency,
    minutesUntilStart: Math.round((startAt.getTime() - now.getTime()) / 60_000),
    isToday,
    isPast,
    overCapacity,
    pendingRequest: request,
    needsAttention: attentionReason !== null,
    attentionReason,
    specialRequests: doc.specialRequests ?? null,
    createdAt: (doc.createdAt ?? startAt).toISOString(),
  };
}

// -------------------------------------------------------------------- detail --

export type ReservationDetail = {
  reservation: ReservationRow;
  timeline: Array<{
    from: string | null;
    to: string;
    changedAt: string;
    actorType: string;
    actorName: string | null;
    reason: string | null;
  }>;
  notes: Array<{ id: string; body: string; author: string | null; createdAt: string }>;
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    status: string;
    referenceNumber: string | null;
    notes: string | null;
    paymentDate: string;
    recordedBy: string | null;
  }>;
  balances: { expected: number; collected: number; outstanding: number; refunded: number };
  customerId: string | null;
  roomId: string | null;
  allowedActions: AdminAction[];
  advisory: string | null;
  cancellation: {
    status: string;
    reason: string | null;
    requestedAt: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    cutoffHours: number;
  };
};

export async function getReservationDetail(id: string, actor?: Actor): Promise<ReservationDetail> {
  const club = await getClubSettings();
  const doc = await Reservation.findById(id)
    .populate<{ customer: { _id: unknown; fullName: string; mobileNumber: string; email: string | null } | null }>(
      "customer",
      "fullName mobileNumber email",
    )
    .populate<{ room: { _id: unknown; name: string; slug: string; capacity: number } | null }>(
      "room",
      "name slug capacity",
    )
    .lean();

  if (!doc) throw new NotFoundError("That reservation no longer exists.");

  const typed = doc as unknown as ReservationDocLike & {
    _id: unknown;
    customer?: { _id: unknown } | null;
    room?: { _id: unknown } | null;
    statusHistory?: Array<{
      from: string | null;
      to: string;
      changedAt: Date;
      actorType: string;
      reason?: string | null;
      changedBy?: unknown;
    }>;
    internalNotes?: Array<{ _id: unknown; body: string; createdAt: Date; author?: unknown }>;
    cancellationRequest?: {
      status: "NONE" | "PENDING" | "APPROVED" | "DECLINED";
      reason?: string | null;
      requestedAt?: Date | null;
      decidedAt?: Date | null;
      decisionNote?: string | null;
    };
  };

  const historyIds = (typed.statusHistory ?? [])
    .map((entry) => entry.changedBy)
    .filter((value): value is string => typeof value === "string" || typeof value === "object")
    .map((value) => String(value))
    .filter(Boolean);
  const noteIds = (typed.internalNotes ?? [])
    .map((note) => note.author)
    .filter(Boolean)
    .map((value) => String(value));
  const actorIds = [...new Set([...historyIds, ...noteIds])];
  const actors = actorIds.length
    ? await AdminUser.find({ _id: { $in: actorIds } }).select("name").lean()
    : [];
  const actorNames = new Map(actors.map((actor) => [String(actor._id), actor.name]));

  const paymentDocs = await Payment.find({ reservation: typed._id })
    .sort({ paymentDate: -1 })
    .populate<{ recordedBy: { name: string } | null }>("recordedBy", "name")
    .lean();

  const collected = paymentDocs
    .filter((payment) => payment.paymentStatus === "PAID" || payment.paymentStatus === "PARTIALLY_PAID")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const refunded = paymentDocs
    .filter((payment) => payment.paymentStatus === "REFUNDED")
    .reduce((sum, payment) => sum + payment.amount, 0);

  const row = toRow(typed, todayInClubTime(club), new Date());
  const now = new Date();

  return {
    reservation: row,
    timeline: (typed.statusHistory ?? []).map((entry) => ({
      from: entry.from ?? null,
      to: entry.to,
      changedAt: new Date(entry.changedAt).toISOString(),
      actorType: entry.actorType,
      actorName: entry.changedBy ? (actorNames.get(String(entry.changedBy)) ?? "Former staff") : null,
      reason: entry.reason ?? null,
    })),
    notes: (typed.internalNotes ?? []).map((note) => ({
      id: String(note._id),
      body: note.body,
      author: note.author ? (actorNames.get(String(note.author)) ?? "Former staff") : null,
      createdAt: new Date(note.createdAt).toISOString(),
    })),
    payments: paymentDocs.map((payment) => ({
      id: String(payment._id),
      amount: payment.amount,
      method: payment.paymentMethod,
      status: payment.paymentStatus,
      referenceNumber: payment.referenceNumber ?? null,
      notes: payment.notes ?? null,
      paymentDate: new Date(payment.paymentDate).toISOString(),
      recordedBy: payment.recordedBy?.name ?? null,
    })),
    balances: {
      expected: row.amount,
      collected,
      outstanding: Math.max(0, row.amount - collected + refunded),
      refunded,
    },
    customerId: typed.customer ? String(typed.customer._id) : null,
    roomId: typed.room ? String(typed.room._id) : null,
    allowedActions: allowedActionsFor(row, now, actor),
    advisory: advisoryFor(row, now),
    cancellation: {
      status: typed.cancellationRequest?.status ?? "NONE",
      reason: typed.cancellationRequest?.reason ?? null,
      requestedAt: typed.cancellationRequest?.requestedAt
        ? new Date(typed.cancellationRequest.requestedAt).toISOString()
        : null,
      decidedAt: typed.cancellationRequest?.decidedAt
        ? new Date(typed.cancellationRequest.decidedAt).toISOString()
        : null,
      decisionNote: typed.cancellationRequest?.decisionNote ?? null,
      cutoffHours: club.cancellationCutoffHours,
    },
  };
}

function allowedActionsFor(row: ReservationRow, now: Date, actor?: Actor): AdminAction[] {
  const actions: AdminAction[] = [];
  for (const [action, transition] of Object.entries(RESERVATION_TRANSITIONS) as [AdminAction, Transition][]) {
    if (!transition.from.includes(row.status)) continue;
    // Hidden, not disabled-with-a-403: the board is used at speed, and an action
    // this account can never take is noise. The service still enforces it.
    if (actor && !actorMayPerform(actor, action)) continue;
    if (row.isPast && (action === "CONFIRM" || action === "CHECK_IN" || action === "NO_SHOW")) continue;
    if (row.status === "CHECKED_IN" && action === "CHECK_IN") continue;
    if (row.minutesUntilStart < 0 && action === "CHECK_IN") continue;
    if (row.minutesUntilStart < 0 && action === "CONFIRM") continue;
    void now;
    actions.push(action);
  }
  return actions;
}

function advisoryFor(row: ReservationRow, _now: Date): string | null {
  if (row.overCapacity) {
    return `${row.guestCount} guests in ${row.roomName}, which is licensed for ${row.roomCapacity}. Confirm the room can take them or move the booking.`;
  }
  if (row.status === "PENDING" && row.minutesUntilStart < 0) {
    return "This booking's window has already passed while it was still pending.";
  }
  return null;
}

// ------------------------------------------------------------------ mutations --

type HistoryEntry = {
  from: ReservationStatus | null;
  to: ReservationStatus;
  changedAt: Date;
  changedBy: string | null;
  actorType: "ADMIN" | "CUSTOMER" | "SYSTEM";
  reason: string | null;
};

function historyEntry(
  from: ReservationStatus,
  to: ReservationStatus,
  actor: Actor,
  reason: string | null,
): HistoryEntry {
  return {
    from,
    to,
    changedAt: new Date(),
    changedBy: actor.id,
    actorType: "ADMIN",
    reason,
  };
}

/** Keep `room_slot_locks` in step with the reservation status. */
async function syncLocks(
  reservationId: unknown,
  roomId: unknown,
  options: { release: boolean; status?: ReservationStatus },
): Promise<void> {
  try {
    if (options.release) {
      await RoomSlotLock.deleteMany({ reservation: reservationId });
      return;
    }
    if (options.status) {
      await RoomSlotLock.updateMany(
        { reservation: reservationId, room: roomId },
        { $set: { status: options.status } },
      );
    }
  } catch (error) {
    logger.error("admin.reservations.locks", "Failed to sync slot locks", error);
  }
}

export type ActionResult = {
  ok: true;
  status: ReservationStatus;
  label: string;
  message: string;
  advisory: string | null;
  reservation: ReservationRow;
};

/**
 * Which capability an action needs.
 *
 * The route can only guard one permission (it does not read the body before
 * authorizing), and "approve/decline" versus "the guest arrived" are genuinely
 * different powers: a floor supervisor may seat people and close out a night
 * without being able to accept a booking. So the decision actions are checked
 * here, against the acting account's role, as well.
 */
export const ACTION_PERMISSION: Record<AdminAction, Permission> = {
  CONFIRM: PERMISSIONS.RESERVATION_DECIDE,
  REJECT: PERMISSIONS.RESERVATION_DECIDE,
  CHECK_IN: PERMISSIONS.RESERVATION_CHECK_IN,
  COMPLETE: PERMISSIONS.RESERVATION_STATUS,
  NO_SHOW: PERMISSIONS.RESERVATION_STATUS,
  CANCEL: PERMISSIONS.RESERVATION_STATUS,
  EXPIRE: PERMISSIONS.RESERVATION_STATUS,
};

export function actorMayPerform(actor: Actor, action: AdminAction): boolean {
  return roleHasPermission(actor.role as AdminRole, ACTION_PERMISSION[action]);
}

export async function applyReservationAction(
  id: string,
  input: ReservationActionInput,
  actor: Actor,
): Promise<ActionResult> {
  const club = await getClubSettings();
  const transition = RESERVATION_TRANSITIONS[input.action];
  if (!transition) throw new ValidationError("That action is not available.");
  if (!actorMayPerform(actor, input.action)) {
    throw new ForbiddenError("Your role does not include permission for this action.");
  }

  const existing = await Reservation.findById(id).lean();
  if (!existing) throw new NotFoundError("That reservation no longer exists.");
  if (input.action === "CHECK_IN" && existing.status === "PENDING" && !roleHasPermission(actor.role as AdminRole, PERMISSIONS.RESERVATION_DECIDE)) {
    throw new ForbiddenError("A pending reservation must be confirmed by an admin before check-in.");
  }
  if (!transition.from.includes(existing.status as ReservationStatus)) {
    // The payload was fine; the booking has simply moved on. That is a conflict
    // with the current state, so the client can re-read and offer the actions that
    // *do* apply now.
    throw new ConflictError(
      `This booking is already ${existing.status.toLowerCase().replace("_", "-")} — "${transition.label}" no longer applies.`,
    );
  }

  const now = new Date();
  const set: Record<string, unknown> = { status: transition.to };
  const unset: Record<string, 1> = {};

  switch (input.action) {
    case "CONFIRM":
      set.confirmedAt = now;
      set.pendingExpiresAt = null;
      break;
    case "CHECK_IN":
      set.checkedInAt = now;
      set.pendingExpiresAt = null;
      if (existing.status === "PENDING") set.confirmedAt = now;
      break;
    case "COMPLETE":
      set.completedAt = now;
      break;
    case "CANCEL":
    case "REJECT":
    case "NO_SHOW":
    case "EXPIRE":
      if (input.action === "CANCEL") {
        set.cancelledAt = now;
        set.cancellationReason = blankToNull(input.reason ?? null);
        set["cancellationRequest.status"] =
          existing.cancellationRequest?.status === "PENDING" ? "APPROVED" : existing.cancellationRequest?.status ?? "NONE";
        set["cancellationRequest.decidedAt"] = now;
        set["cancellationRequest.decidedBy"] = actor.id;
      }
      // A released booking must not keep the room, nor the idempotency key that
      // would otherwise block the same guest from rebooking it.
      unset.submissionKey = 1;
      set.pendingExpiresAt = null;
      break;
  }

  // Add confirmation messages in the same guarded document update as the
  // transition, so a retry or competing approval cannot enqueue them twice.
  let confirmationJobs: ReturnType<typeof bookingNotifications> = [];
  if (input.action === "CONFIRM" || (input.action === "CHECK_IN" && existing.status === "PENDING")) {
    const [customer, room] = await Promise.all([Customer.findById(existing.customer).lean(), Room.findById(existing.room).lean()]);
    if (!customer || !room) throw new NotFoundError("The guest or room for this booking no longer exists.");
    confirmationJobs = bookingNotifications({ reference: existing.reservationReference,
      date: existing.reservationDate, time: existing.startTime, room: room.name, roomId: String(existing.room),
      mobile: customer.mobileNumber, email: customer.email, confirmed: true });
  }
  const updated = await Reservation.findOneAndUpdate(
    {
      _id: id,
      status: existing.status,
      // Once a hold expires it may already have been reclaimed by another
      // booking. Never revive it into a blocking state without its locks.
      ...(existing.status === "PENDING" && (input.action === "CONFIRM" || input.action === "CHECK_IN")
        ? { $or: [{ pendingExpiresAt: null }, { pendingExpiresAt: { $gt: now } }] }
        : {}),
    },
    {
      $set: set,
      ...(Object.keys(unset).length ? { $unset: unset } : {}),
      $push: {
        ...(confirmationJobs.length ? { notifications: { $each: confirmationJobs } } : {}),
        statusHistory: historyEntry(
          existing.status as ReservationStatus,
          transition.to,
          actor,
          blankToNull(input.reason ?? null) ?? defaultReason(input.action, actor),
        ),
      },
    },
    { new: true },
  )
    .populate<{ customer: { fullName: string; mobileNumber: string; email: string | null } | null }>(
      "customer",
      "fullName mobileNumber email",
    )
    .populate<{ room: { name: string; slug: string; capacity: number } | null }>("room", "name slug capacity");

  if (!updated) {
    const current = await Reservation.findById(id).lean();
    throw new ConflictError(
      current
        ? `Someone just moved this booking to ${current.status}. Reload to see the latest state.`
        : "That reservation no longer exists.",
    );
  }

  await syncLocks(updated._id, existing.room, {
    release: transition.releasesLocks,
    status: transition.to,
  });

  const row = toRow(updated as unknown as ReservationDocLike, todayInClubTime(club), now);
  return {
    ok: true,
    status: row.status,
    label: transition.label,
    message: `${transition.label} · ${row.reference}`,
    advisory: advisoryFor(row, now),
    reservation: row,
  };
}

function defaultReason(action: AdminAction, actor: Actor): string {
  switch (action) {
    case "CONFIRM":
      return `Approved by ${actor.name}`;
    case "REJECT":
      return `Rejected by ${actor.name}`;
    case "CHECK_IN":
      return `Checked in at the door by ${actor.name}`;
    case "COMPLETE":
      return `Closed out by ${actor.name}`;
    case "NO_SHOW":
      return `No-show recorded by ${actor.name}`;
    case "CANCEL":
      return `Cancelled by ${actor.name}`;
    case "EXPIRE":
      return `Hold released by ${actor.name}`;
    default:
      return `Updated by ${actor.name}`;
  }
}

// -------------------------------------------------- cancellation suggestions --

export async function decideCancellationRequest(
  id: string,
  decision: "APPROVED" | "DECLINED",
  note: string | null,
  actor: Actor,
): Promise<ActionResult> {
  const club = await getClubSettings();
  const existing = await Reservation.findById(id).lean();
  if (!existing) throw new ValidationError("That reservation no longer exists.");
  if (existing.cancellationRequest?.status !== "PENDING") {
    // Someone (or the guest themselves) already resolved it — re-read, don't retry.
    throw new ConflictError("There is no open cancellation request on this booking.");
  }

  const now = new Date();
  if (decision === "DECLINED") {
    const updated = await Reservation.findOneAndUpdate(
      { _id: id, "cancellationRequest.status": "PENDING" },
      {
        $set: {
          "cancellationRequest.status": "DECLINED",
          "cancellationRequest.decidedAt": now,
          "cancellationRequest.decidedBy": actor.id,
          "cancellationRequest.decisionNote": blankToNull(note),
        },
        $push: {
          statusHistory: historyEntry(
            existing.status as ReservationStatus,
            existing.status as ReservationStatus,
            actor,
            `Cancellation request declined${note ? `: ${note}` : ""}`,
          ),
        },
      },
      { new: true },
    )
      .populate("customer", "fullName mobileNumber email")
      .populate("room", "name slug capacity");

    if (!updated) throw new ConflictError("Someone already answered this request. Reload the page.");
    const row = toRow(updated as unknown as ReservationDocLike, todayInClubTime(club), now);
    return {
      ok: true,
      status: row.status,
      label: "Request declined",
      message: `The guest keeps their room — call them on ${row.customerMobile}.`,
      advisory: null,
      reservation: row,
    };
  }

  // Approved → perform the cancellation the customer asked for.
  return applyReservationAction(id, { action: "CANCEL", reason: note ?? "Cancellation request approved" }, actor);
}

// ---------------------------------------------------------------------- notes --

export async function addInternalNote(id: string, body: string, actor: Actor): Promise<{ ok: true }> {
  const updated = await Reservation.findByIdAndUpdate(
    id,
    {
      $push: {
        internalNotes: { body: sanitizeText(body), author: actor.id, createdAt: new Date() },
      },
    },
    { new: true },
  ).lean();
  if (!updated) throw new ValidationError("That reservation no longer exists.");
  return { ok: true };
}

// ----------------------------------------------------------------- guest edit --

export async function updateReservationDetails(
  id: string,
  input: ReservationEditInput,
  actor: Actor,
): Promise<{ ok: true; changed: string[] }> {
  const doc = await Reservation.findById(id).lean();
  if (!doc) throw new ValidationError("That reservation no longer exists.");

  const fullName = normalizePersonName(input.fullName);
  const mobile = normalizeMobileNumber(input.mobileNumber);
  if (!mobile) throw new ValidationError("Enter a valid PH mobile number.");
  const email = input.email ? normalizeEmail(input.email) : null;
  const changed: string[] = [];

  const customer = await Customer.findById(doc.customer).lean();
  if (!customer) throw new ValidationError("The customer record for this booking is missing.");

  const reservationSet: Record<string, unknown> = {};
  if (input.guestCount !== doc.guestCount) {
    const room = await Room.findById(doc.room).select("capacity name").lean();
    if (room && input.guestCount > room.capacity) {
      throw new ValidationError(`This room seats ${room.capacity} guests. Pick a bigger room first.`);
    }
    reservationSet.guestCount = input.guestCount;
    changed.push("party size");
  }
  const requests = blankToNull(input.specialRequests ?? null);
  if ((doc.specialRequests ?? null) !== requests) {
    reservationSet.specialRequests = requests === null ? null : sanitizeText(requests);
    changed.push("special requests");
  }

  const customerSet: Record<string, unknown> = {};
  if (customer.fullName !== fullName) {
    customerSet.fullName = fullName;
    changed.push("guest name");
  }
  if ((customer.email ?? null) !== email) {
    customerSet.email = email;
    changed.push("email");
  }
  const mobileChanged = customer.mobileNumber !== mobile;
  if (mobileChanged) {
    customerSet.mobileNumber = mobile;
    changed.push("mobile number");
  }

  if (Object.keys(customerSet).length > 0) {
    try {
      await Customer.updateOne({ _id: customer._id }, { $set: customerSet });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ValidationError(
          "Another customer already uses that mobile number. Merge the two bookings on that profile instead.",
        );
      }
      throw error;
    }
  }

  // The idempotency key is derived from the mobile number: keep it truthful or a
  // retried submission would create a second booking instead of replaying.
  if (mobileChanged && doc.status === "PENDING") {
    try {
      const room = await Room.findById(doc.room).select("_id").lean();
      if (room) {
        reservationSet.submissionKey = buildSubmissionKey({
          mobile,
          roomId: String(room._id),
          startAtIso: new Date(doc.startAt).toISOString(),
          durationMinutes: doc.durationMinutes,
        });
      }
    } catch (error) {
      logger.warn("admin.reservations.edit", "Could not re-key submission", error);
    }
  }

  if (Object.keys(reservationSet).length > 0) {
    await Reservation.updateOne({ _id: id }, { $set: reservationSet });
  }

  const note = blankToNull(input.internalNote ?? null);
  if (note) {
    await addInternalNote(id, `Guest details updated (${changed.join(", ") || "no field changes"}): ${note}`, actor);
  } else if (changed.length > 0) {
    await addInternalNote(id, `Guest details updated: ${changed.join(", ")}`, actor);
  }

  return { ok: true, changed };
}

// --------------------------------------------------------------------- moving --

export async function moveReservation(
  id: string,
  input: ReservationMoveInput,
  actor: Actor,
): Promise<{ ok: true; message: string; amount: number }> {
  const club = await getClubSettings();
  const doc = await Reservation.findById(id).lean();
  if (!doc) throw new NotFoundError("That reservation no longer exists.");
  if (!LIVE_STATUSES.includes(doc.status as ReservationStatus)) {
    throw new ValidationError(
      `A ${String(doc.status).toLowerCase().replace("_", "-")} booking cannot be moved. Create a new one instead.`,
    );
  }

  const room = await Room.findById(input.roomId).lean();
  if (!room) throw new ValidationError("That room does not exist.");

  const startAt = clubDateTimeToUtc(input.date, input.startTime, club.timezone);
  const endAt = addMinutes(startAt, input.durationMinutes);
  const endTime = minutesToHHMM((hhmmToMinutes(input.startTime) + input.durationMinutes) % 1440);

  const context = await loadAvailabilityContext(club, input.date, {
    now: new Date(Date.now() - 31 * 60_000),
    excludeReservationId: id,
  });
  const availability = computeRoomAvailability(
    context,
    input.startTime,
    input.durationMinutes,
    doc.guestCount,
  ).find((entry) => entry.room.id === String(room._id));

  if (!availability || !availability.available) {
    throw new ValidationError(
      conflictMessageFor(
        availability as never,
        input.startTime,
        endTime,
      ),
    );
  }

  const previous = await RoomSlotLock.find({ reservation: doc._id }).lean();
  await RoomSlotLock.deleteMany({ reservation: doc._id });

  const boundaries: Date[] = [];
  const gridMinutes = 30;
  for (
    let cursor = Math.ceil(startAt.getTime() / (gridMinutes * 60_000)) * gridMinutes * 60_000;
    cursor < endAt.getTime();
    cursor += gridMinutes * 60_000
  ) {
    boundaries.push(new Date(cursor));
  }
  if (boundaries.length === 0) boundaries.push(new Date(startAt));

  try {
    await RoomSlotLock.insertMany(
      boundaries.map((slotStart) => ({
        room: room._id,
        slotStart,
        slotEnd: addMinutes(slotStart, gridMinutes),
        reservation: doc._id,
        status: doc.status,
      })),
      { ordered: true },
    );
  } catch (error) {
    await RoomSlotLock.insertMany(
      previous.map((lock) => ({
        room: lock.room,
        slotStart: lock.slotStart,
        slotEnd: lock.slotEnd,
        reservation: lock.reservation,
        status: lock.status,
      })),
      { ordered: false },
    ).catch(() => undefined);
    if (isDuplicateKeyError(error)) {
      throw new ValidationError("That room was just taken for the new time. Pick another slot.");
    }
    throw error;
  }

  const amount = calculateReservationAmount(room.hourlyRate, input.durationMinutes);
  const label = `${formatClubDateLong(input.date)} · ${formatClubTime12h(input.startTime)}–${formatClubTime12h(endTime)} in ${room.name}`;

  await Reservation.updateOne(
    { _id: id },
    {
      $set: {
        room: room._id,
        reservationDate: input.date,
        startTime: input.startTime,
        endTime,
        startAt,
        endAt,
        durationMinutes: input.durationMinutes,
        estimatedAmount: amount,
        currency: club.currency,
      },
      $push: {
        statusHistory: historyEntry(
          doc.status as ReservationStatus,
          doc.status as ReservationStatus,
          actor,
          `Moved to ${label}. ${input.reason ?? ""}`.trim(),
        ),
      },
    },
  );

  return { ok: true, message: `Booking moved to ${label}`, amount };
}

// ------------------------------------------------------------------- walk-ins --

export type WalkInInput = {
  roomSlug: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  fullName: string;
  mobileNumber: string;
  email?: string | null;
  guestCount: number;
  specialRequests?: string | null;
  /** Front-desk bookings are confirmed on creation unless staff uncheck it. */
  confirmNow?: boolean;
  autoConfirm?: boolean;
};

export async function createStaffReservation(
  input: WalkInInput,
  actor: Actor,
): Promise<{ ok: true; reference: string; amount: number; status: ReservationStatus }> {
  const club = await getClubSettings();
  const autoConfirm = input.confirmNow ?? input.autoConfirm ?? true;

  const result = await createReservation({
    input: {
      roomSlug: input.roomSlug,
      date: input.date,
      startTime: input.startTime,
      durationMinutes: input.durationMinutes,
      fullName: input.fullName,
      mobileNumber: input.mobileNumber,
      email: input.email ?? "",
      guestCount: input.guestCount,
      specialRequests: input.specialRequests ?? undefined,
      acceptPolicy: true,
    },
    settings: club,
    // A host may seat a party that is already standing at the counter, so the
    // public 30-minute lead-time floor is measured from a slightly earlier clock.
    options: {
      now: new Date(Date.now() - 31 * 60_000),
      source: "ADMIN",
      actorId: actor.id,
      autoConfirm,
      note: `Created at the front desk by ${actor.name}`,
    },
  });

  return {
    ok: true,
    reference: result.reservation.reference,
    amount: result.reservation.estimatedAmount,
    status: result.reservation.status,
  };
}

// ------------------------------------------------------------- expiry sweep --

export type SweepResult = { expired: number; releasedSlots: number };

/** Expire a bounded batch. Each guarded transition and its lock release are
 * committed together. A concurrent confirmation can never lose its slot locks. */
export async function sweepExpiredPending(): Promise<SweepResult> {
  await connectToDatabase();
  const now = new Date();
  const stale = await Reservation.find({ status: "PENDING", pendingExpiresAt: { $ne: null, $lte: now } })
    .sort({ pendingExpiresAt: 1 }).limit(200).select("_id").lean();
  let expired = 0;
  let releasedSlots = 0;
  const deadline = Date.now() + 40_000;
  for (const item of stale) {
    if (Date.now() >= deadline) break;
    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const updated = await Reservation.updateOne(
          { _id: item._id, status: "PENDING", pendingExpiresAt: { $ne: null, $lte: now } },
          { $set: { status: "EXPIRED", pendingExpiresAt: null }, $unset: { submissionKey: 1 },
            $push: { statusHistory: { from: "PENDING", to: "EXPIRED", changedAt: now,
              changedBy: null, actorType: "SYSTEM", reason: "Hold window elapsed before confirmation" } } },
          { session },
        );
        if (!updated.modifiedCount) return { expired: 0, releasedSlots: 0 };
        const released = await RoomSlotLock.deleteMany({ reservation: item._id }, { session });
        return { expired: 1, releasedSlots: released.deletedCount ?? 0 };
      });
      expired += result?.expired ?? 0;
      releasedSlots += result?.releasedSlots ?? 0;
    } finally { await session.endSession(); }
  }
  if (expired) logger.info("admin.reservations.sweep", "Expired pending holds released", { expired, slotsReleased: releasedSlots });
  return { expired, releasedSlots };
}

// ------------------------------------------------------------- calendar view --

export type CalendarCell = {
  roomId: string;
  roomName: string;
  rows: Array<{
    id: string;
    reference: string;
    status: ReservationStatus;
    startAt: string;
    endAt: string;
    label: string;
    minutesFromOpen: number;
    durationMinutes: number;
    left: number;
    width: number;
  }>;
};

/**
 * One row per room, positioned on the night's timeline (open → close).
 * Pure geometry — the numbers are driven by the club's operating window so an
 * overnight session renders correctly across midnight.
 */
export async function buildCalendar(date: string, settings?: ClubSettingsView) {
  const club = settings ?? (await getClubSettings());
  const openMinutes = hhmmToMinutes(club.openingTime);
  const closeMinutes = hhmmToMinutes(club.closingTime);
  const nightMinutes = closeMinutes <= openMinutes ? 1440 - openMinutes + closeMinutes : closeMinutes - openMinutes;

  const rooms = await Room.find({})
    .sort({ sortOrder: 1, name: 1 })
    .select("name")
    .lean();

  const docs = await Reservation.find({
    reservationDate: date,
    status: { $in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
  })
    .populate<{ customer: { fullName: string } | null }>("customer", "fullName")
    .lean();

  const openAt = clubDateTimeToUtc(date, club.openingTime, club.timezone);
  const cells: CalendarCell[] = rooms.map((room) => ({
    roomId: String(room._id),
    roomName: room.name,
    rows: [],
  }));
  const byRoom = new Map(cells.map((cell) => [cell.roomId, cell]));

  for (const doc of docs) {
    const cell = byRoom.get(String(doc.room));
    if (!cell) continue;
    const startOffset = (new Date(doc.startAt).getTime() - openAt.getTime()) / 60_000;
    const clampedStart = Math.max(0, startOffset);
    const width = Math.min(nightMinutes - clampedStart, Math.max(45, doc.durationMinutes));
    cell.rows.push({
      id: String(doc._id),
      reference: doc.reservationReference,
      status: doc.status,
      startAt: new Date(doc.startAt).toISOString(),
      endAt: new Date(doc.endAt).toISOString(),
      label: `${doc.customer?.fullName ?? "Guest"} · ${formatClubTime12h(doc.startTime)}`,
      minutesFromOpen: startOffset,
      durationMinutes: doc.durationMinutes,
      left: Math.round((clampedStart / nightMinutes) * 1000) / 10,
      width: Math.round((width / nightMinutes) * 1000) / 10,
    });
  }

  const blocks = await RoomBlock.find({
    isActive: true,
    startAt: { $lt: addMinutes(openAt, nightMinutes) },
    endAt: { $gt: openAt },
  }).lean();

  return {
    date,
    openingTime: club.openingTime,
    closingTime: club.closingTime,
    nightMinutes,
    slots: Array.from({ length: Math.floor(nightMinutes / 60) + 1 }, (_unused, index) =>
      minutesToHHMM((openMinutes + index * 60) % 1440),
    ),
    cells,
    blocks: blocks.map((block) => ({
      id: String(block._id),
      roomId: block.room ? String(block.room) : null,
      startAt: new Date(block.startAt).toISOString(),
      endAt: new Date(block.endAt).toISOString(),
      reason: block.reason ?? null,
    })),
    totals: {
      bookings: docs.length,
      rooms: rooms.length,
      occupancy:
        rooms.length === 0
          ? 0
          : Math.round(
              (docs.reduce((sum, doc) => sum + doc.durationMinutes, 0) / (rooms.length * nightMinutes)) * 100,
            ),
    },
  };
}
