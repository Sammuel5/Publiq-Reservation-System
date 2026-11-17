import { bookingNotifications } from "@/lib/services/notifications";
import { createHash } from "node:crypto";
import { connectToDatabase } from "@/lib/db/mongoose";
import {
  Customer,
  Payment,
  Reservation,
  RoomSlotLock,
  type ReservationStatus,
} from "@/lib/db/models";
import type { ClubSettingsView } from "@/lib/services/club-settings";
import {
  computeRoomAvailability,
  loadAvailabilityContext,
} from "@/lib/services/availability";
import { createWithUniqueReference, normalizeReference } from "@/lib/services/reservation-reference";
import {
  addMinutes,
  formatClubTime12h,
  clubDateTimeToUtc,
  hhmmToMinutes,
  minutesToHHMM,
} from "@/lib/utils/datetime";
import { calculateReservationAmount, formatMoney } from "@/lib/utils/money";
import { blankToNull, normalizeMobileNumber, normalizePersonName, sanitizeText } from "@/lib/utils/normalize";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  isDuplicateKeyError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { CreateReservationInput } from "@/lib/validation/reservation";

/**
 * Reservation service — the single place where reservations are created,
 * looked up and cancelled. UI components and route handlers never touch
 * Mongoose documents directly.
 *
 * Double-booking protection (Phase 4 hardens and load-tests this):
 *  - the room window is re-verified against the database on submission,
 *  - one `RoomSlotLock` document per 30-minute slot is inserted first; the unique
 *    index `(room, slotStart)` makes a concurrent second insert fail atomically,
 *  - the reservation is written only after the locks are held; if the write
 *    fails, the locks are released (compensation),
 *  - locks left by an expired PENDING hold are cleared before the insert,
 *  - `submissionKey` (unique, partial) makes accidental double-submits idempotent.
 */

const SLOT_MINUTES = 30;

export type PublicReservation = {
  reference: string;
  status: ReservationStatus;
  customerName: string;
  mobileMasked: string;
  email: string | null;
  room: {
    slug: string;
    name: string;
    categorySlug: string;
    capacity: number;
    hourlyRate: number;
    image: string | null;
  };
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  guestCount: number;
  estimatedAmount: number;
  currency: string;
  specialRequests: string | null;
  createdAt: string;
  pendingExpiresAt: string | null;
  cancellation: {
    status: "NONE" | "PENDING" | "APPROVED" | "DECLINED";
    requestedAt: string | null;
    reason: string | null;
  };
  /** Customer-facing hints computed server-side. */
  canCancel: boolean;
  cancellationRequiresApproval: boolean;
  cancellationCutoffHours: number;
};

export type CreateReservationResult = {
  reservation: PublicReservation;
  /** Shown once so the confirmation page can be opened without exposing data. */
  accessToken: string;
  /** True when an identical submission already existed (idempotent replay). */
  duplicate: boolean;
  policy: { cancellationPolicy: string; cancellationCutoffHours: number };
};

function maskMobile(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return `••••••${digits.slice(-4)}`;
}

export function buildSubmissionKey(parts: {
  mobile: string;
  roomId: string;
  startAtIso: string;
  durationMinutes: number;
}): string {
  return createHash("sha256")
    .update(
      `${parts.mobile}|${parts.roomId}|${parts.startAtIso}|${parts.durationMinutes}`,
    )
    .digest("hex");
}

/** Round a UTC instant up to the next 30-minute slot boundary (club-local grid). */
function slotBoundaries(startAt: Date, endAt: Date): Date[] {
  const boundaries: Date[] = [];
  const start = new Date(Math.ceil(startAt.getTime() / (SLOT_MINUTES * 60_000)) * SLOT_MINUTES * 60_000);
  for (let cursor = start.getTime(); cursor < endAt.getTime(); cursor += SLOT_MINUTES * 60_000) {
    boundaries.push(new Date(cursor));
  }
  // Always protect at least the first slot, even for odd start times.
  if (boundaries.length === 0) boundaries.push(start);
  return boundaries;
}

/**
 * Release slot locks that no longer block anything before claiming them.
 *
 * A PENDING hold stops blocking the room the moment `pendingExpiresAt` passes
 * (that is exactly what `loadAvailabilityContext` implements), but its rows in
 * `room_slot_locks` stay behind until the Phase 4 sweep runs. Without this
 * cleanup a customer would be offered a slot the availability engine declared
 * free and then be rejected by the unique index forever. Locks whose parent
 * reservation was deleted are cleaned up on the same pass.
 */
async function releaseStaleLocks(roomId: string, slots: Date[], now: Date): Promise<void> {
  const held = await RoomSlotLock.find({ room: roomId, slotStart: { $in: slots } })
    .select("reservation")
    .lean<Array<{ reservation: unknown }>>();
  if (held.length === 0) return;

  const ownerIds = [...new Set(held.map((lock) => String(lock.reservation)))];
  const live = await Reservation.find({
    $or: [
      { _id: { $in: ownerIds }, status: { $in: ["CONFIRMED", "CHECKED_IN"] } },
      { _id: { $in: ownerIds }, status: "PENDING", pendingExpiresAt: { $gt: now } },
      // A pending hold with no expiry date never expires by design.
      { _id: { $in: ownerIds }, status: "PENDING", pendingExpiresAt: null },
    ],
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();

  const liveIds = new Set(live.map((doc) => String(doc._id)));
  const staleIds = ownerIds.filter((id) => !liveIds.has(id));
  if (staleIds.length === 0) return;

  await RoomSlotLock.deleteMany({ room: roomId, slotStart: { $in: slots }, reservation: { $in: staleIds } });
  logger.warn("reservations.releaseStaleLocks", "Released expired slot locks", {
    roomId,
    locks: staleIds.length,
  });
}

/** Shape a reservation document into the public (customer-safe) projection. */
function toPublicReservation(
  reservation: {
    reservationReference: string;
    status: string;
    reservationDate: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    guestCount: number;
    estimatedAmount: number;
    currency: string;
    specialRequests: string | null;
    createdAt: Date;
    pendingExpiresAt: Date | null;
    startAt: Date;
    cancellationRequest?: {
      status?: string;
      reason?: string | null;
      requestedAt?: Date | null;
    } | null;
  },
  customer: { fullName: string; mobileNumber: string; email: string | null },
  room: { slug: string; name: string; categorySlug: string; capacity: number; hourlyRate: number; coverImage?: string | null; images?: string[] },
  settings: ClubSettingsView,
): PublicReservation {
  const cancellationStatus =
    (reservation.cancellationRequest?.status as PublicReservation["cancellation"]["status"]) ??
    "NONE";
  const hoursUntilStart = (reservation.startAt.getTime() - Date.now()) / 3_600_000;
  const cancellableStatus = reservation.status === "PENDING" || reservation.status === "CONFIRMED";
  const withinCutoff = hoursUntilStart < settings.cancellationCutoffHours;

  return {
    reference: reservation.reservationReference,
    status: reservation.status as ReservationStatus,
    customerName: customer.fullName,
    mobileMasked: maskMobile(customer.mobileNumber),
    email: customer.email,
    room: {
      slug: room.slug,
      name: room.name,
      categorySlug: room.categorySlug,
      capacity: room.capacity,
      hourlyRate: room.hourlyRate,
      image: room.coverImage ?? room.images?.[0] ?? null,
    },
    date: reservation.reservationDate,
    startTime: reservation.startTime,
    endTime: reservation.endTime,
    durationMinutes: reservation.durationMinutes,
    guestCount: reservation.guestCount,
    estimatedAmount: reservation.estimatedAmount,
    currency: reservation.currency ?? "PHP",
    specialRequests: reservation.specialRequests,
    createdAt: reservation.createdAt.toISOString(),
    pendingExpiresAt: reservation.pendingExpiresAt?.toISOString() ?? null,
    cancellation: {
      status: cancellationStatus,
      requestedAt: reservation.cancellationRequest?.requestedAt?.toISOString() ?? null,
      reason: reservation.cancellationRequest?.reason ?? null,
    },
    canCancel: cancellableStatus && cancellationStatus !== "PENDING",
    cancellationRequiresApproval: withinCutoff,
    cancellationCutoffHours: settings.cancellationCutoffHours,
  };
}


/** Customer-friendly explanation for an unavailable room. */
export function conflictMessageFor(
  availability: { code: string; message: string | null; room: { name: string; capacity: number } } | undefined,
  startTime: string,
  endTime: string,
): string {
  if (!availability) return "That room is not available for the selected time.";

  switch (availability.code) {
    case "CONFLICT":
      return `That room is already reserved for ${formatClubTime12h(startTime)}–${formatClubTime12h(endTime)}. Please choose another time or room.`;
    case "CAPACITY":
      return `That room fits up to ${availability.room.capacity} guests. Choose a larger room or reduce your party.`;
    case "MIN_DURATION":
      return availability.message
        ? `That room needs a longer booking (${availability.message.toLowerCase()}).`
        : "That room needs a longer booking.";
    case "CLOSED_HOURS":
      return "That time is outside our operating hours.";
    case "PAST":
      return "That time has already passed — please pick a later slot.";
    case "BLOCKED":
      return "That room is blocked by the club for this time.";
    default:
      return availability.message ?? "That room is not available for the selected time.";
  }
}

/**
 * Statuses that still own their slot: a repeat of the same submission should
 * return this booking rather than create a second one.
 */
const IDEMPOTENT_STATUSES = new Set([
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
]);

export async function createReservation(params: {
  input: CreateReservationInput;
  settings: ClubSettingsView;
  ipHint?: string | null;
  /**
   * Staff path (Phase 3 admin console). The public wizard never sets these:
   *  - `now` moves the clock the lead-time floor is measured against, so a host
   *    can seat a walk-in party that is already standing at the door,
   *  - `source` / `actorId` / `note` feed the audit trail,
   *  - `autoConfirm` skips PENDING — a front-desk booking is confirmed by
   *    definition, so it must not expire while nobody approves it.
   */
  options?: {
    now?: Date;
    source?: "CUSTOMER" | "ADMIN";
    actorId?: string | null;
    note?: string | null;
    autoConfirm?: boolean;
  };
}): Promise<CreateReservationResult> {
  const { input, settings } = params;
  const options = params.options ?? {};
  await connectToDatabase();

  const mobile = normalizeMobileNumber(input.mobileNumber);
  if (!mobile) throw new ValidationError("Enter a valid PH mobile number.");

  const email = blankToNull(input.email ?? null);
  const fullName = normalizePersonName(input.fullName);
  const specialRequests = blankToNull(input.specialRequests ?? null);

  // --- Room must exist and be bookable -------------------------------------
  const context = await loadAvailabilityContext(settings, input.date, {
    now: options.now,
  });
  const room = context.rooms.find((candidate) => candidate.slug === input.roomSlug);
  if (!room) throw new NotFoundError("That room could not be found.");

  const startAt = clubDateTimeToUtc(input.date, input.startTime, settings.timezone);
  const endAt = addMinutes(startAt, input.durationMinutes);
  // Business-local end time (handles windows that cross midnight).
  const endTime = minutesToHHMM(
    (hhmmToMinutes(input.startTime) + input.durationMinutes) % 1440,
  );

  const submissionKey = buildSubmissionKey({
    mobile,
    roomId: room.id,
    startAtIso: startAt.toISOString(),
    durationMinutes: input.durationMinutes,
  });

  // --- Idempotency ---------------------------------------------------------
  // Checked BEFORE the availability test: a replay of the same submission would
  // otherwise be rejected by its own reservation (the room is now "taken" — by
  // this very booking).
  const existing = await Reservation.findOne({ submissionKey }).select("+accessToken").lean();
  // Only a *live* reservation counts as the duplicate target. A cancelled or
  // rejected booking keeps no claim on the slot, so the key is released and the
  // customer can genuinely rebook the same room and time.
  if (existing && !IDEMPOTENT_STATUSES.has(existing.status)) {
    await Reservation.updateOne({ _id: existing._id }, { $unset: { submissionKey: 1 } });
  } else if (existing) {
    const existingCustomer = await Customer.findById(existing.customer).lean();
    const existingRoom = context.rooms.find((candidate) => candidate.id === String(existing.room));
    if (existingCustomer && existingRoom) {
      return {
        reservation: toPublicReservation(
          existing as never,
          {
            fullName: existingCustomer.fullName,
            mobileNumber: existingCustomer.mobileNumber,
            email: existingCustomer.email ?? null,
          },
          existingRoom,
          settings,
        ),
        accessToken: (existing as { accessToken?: string }).accessToken ?? "",
        duplicate: true,
        policy: {
          cancellationPolicy: settings.cancellationPolicy,
          cancellationCutoffHours: settings.cancellationCutoffHours,
        },
      };
    }
  }

  // --- Authoritative availability check (server-side, not the browser) -----
  const availability = computeRoomAvailability(
    context,
    input.startTime,
    input.durationMinutes,
    input.guestCount,
  ).find((entry) => entry.room.id === room.id);

  if (!availability || !availability.available) {
    throw new ConflictError(conflictMessageFor(availability, input.startTime, endTime), {
      code: availability?.code ?? "CONFLICT",
    });
  }

  // --- Price is always calculated here, never accepted from the client -----
  const estimatedAmount = calculateReservationAmount(room.hourlyRate, input.durationMinutes);

  // --- Customer record (deduplicated on normalized mobile) -----------------
  const customer = await Customer.findOneAndUpdate(
    { mobileNumber: mobile },
    {
      $set: {
        fullName,
        ...(email ? { email } : {}),
      },
      $setOnInsert: { mobileNumber: mobile },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // --- Reserve the room slots (atomic, unique index) -----------------------
  const documentId = new Reservation()._id;
  const boundaries = slotBoundaries(startAt, endAt);

  // Never inherit a hold left behind by an expired PENDING reservation.
  await releaseStaleLocks(room.id, boundaries, new Date());

  try {
    await RoomSlotLock.insertMany(
      boundaries.map((slotStart) => ({
        room: room.id,
        slotStart,
        slotEnd: addMinutes(slotStart, SLOT_MINUTES),
        reservation: documentId,
        status: options.autoConfirm ? "CONFIRMED" : "PENDING",
      })),
      { ordered: true },
    );
  } catch (error) {
    // Ordered insertMany may have inserted earlier slots before a later slot
    // collided. Never leave that partial claim behind.
    await RoomSlotLock.deleteMany({ reservation: documentId });
    if (isDuplicateKeyError(error)) {
      logger.warn("reservations.create", "Slot lock race lost", {
        roomSlug: room.slug,
        date: input.date,
        startTime: input.startTime,
      });
      throw new ConflictError(
        "That room was just taken for this time. Please choose another slot.",
        { code: "SLOT_TAKEN" },
      );
    }
    throw error;
  }

  // --- Persist the reservation --------------------------------------------
  let reservation;
  try {
    reservation = await createWithUniqueReference(async (reference) =>
      Reservation.create({
        _id: documentId,
        reservationReference: reference,
        customer: customer._id,
        room: room.id,
        reservationDate: input.date,
        startTime: input.startTime,
        endTime,
        startAt,
        endAt,
        durationMinutes: input.durationMinutes,
        guestCount: input.guestCount,
        estimatedAmount,
        currency: settings.currency,
        specialRequests,
        status: options.autoConfirm ? "CONFIRMED" : "PENDING",
        pendingExpiresAt: options.autoConfirm
          ? null
          : new Date(Date.now() + settings.pendingExpirationMinutes * 60_000),
        confirmedAt: options.autoConfirm ? new Date() : null,
        source: options.source ?? "CUSTOMER",
        createdBy: options.actorId ?? null,
        submissionKey,
        statusHistory: [
          {
            from: null,
            to: options.autoConfirm ? "CONFIRMED" : "PENDING",
            changedAt: new Date(),
            changedBy: options.actorId ?? null,
            actorType: options.source === "ADMIN" ? "ADMIN" : "CUSTOMER",
            reason:
              options.note ??
              (options.source === "ADMIN"
                ? "Walk-in booking created at the front desk"
                : "Reservation submitted from the customer website"),
          },
        ],
        notifications: bookingNotifications({ reference, date: input.date, time: input.startTime,
          room: room.name, roomId: String(room.id), mobile, email, confirmed: Boolean(options.autoConfirm), staff: options.source !== "ADMIN" }),
        cancellationRequest: { status: "NONE" },
      }),
    );
  } catch (error) {
    // Compensation: never leave orphaned locks behind.
    await RoomSlotLock.deleteMany({ reservation: documentId }).catch(() => undefined);

    if (isDuplicateKeyError(error)) {
      const replay = await Reservation.findOne({ submissionKey }).select("+accessToken").lean();
      if (replay) {
        throw new ConflictError(
          "This reservation was already submitted.",
          { code: "DUPLICATE_SUBMISSION", reference: replay.reservationReference },
        );
      }
    }
    throw error;
  }

  logger.info("reservations.create", "Reservation created", {
    reference: reservation.reservationReference,
    roomSlug: room.slug,
    date: input.date,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    estimatedAmount,
  });

  return {
    reservation: toPublicReservation(
      reservation as never,
      {
        fullName: customer.fullName,
        mobileNumber: customer.mobileNumber,
        email: customer.email ?? null,
      },
      room,
      settings,
    ),
    accessToken: reservation.accessToken ?? "",
    duplicate: false,
    policy: {
      cancellationPolicy: settings.cancellationPolicy,
      cancellationCutoffHours: settings.cancellationCutoffHours,
    },
  };
}

/** Load a reservation only when reference AND mobile number both match. */
async function findVerifiedReservation(
  reference: string,
  mobileRaw: string,
  options: { includeAccessToken?: boolean } = {},
) {
  await connectToDatabase();

  const mobile = normalizeMobileNumber(mobileRaw);
  if (!mobile) throw new ValidationError("Enter a valid PH mobile number.");

  const query = Reservation.findOne({ reservationReference: normalizeReference(reference) })
    .populate("customer")
    .populate("room");
  if (options.includeAccessToken) query.select("+accessToken");

  const reservation = await query.lean();
  if (!reservation) {
    // Same error for "unknown reference" and "wrong mobile" — no enumeration.
    throw new NotFoundError("No reservation matches that reference and mobile number.");
  }

  const customer = reservation.customer as unknown as {
    fullName: string;
    mobileNumber: string;
    email: string | null;
  } | null;

  if (!customer || customer.mobileNumber !== mobile) {
    throw new NotFoundError("No reservation matches that reference and mobile number.");
  }

  const room = reservation.room as unknown as {
    slug: string;
    name: string;
    categorySlug: string;
    capacity: number;
    hourlyRate: number;
    coverImage?: string | null;
    images?: string[];
  } | null;

  if (!room) throw new NotFoundError("That room is no longer listed.");

  return { reservation, customer, room };
}

export async function lookupReservation(params: {
  reference: string;
  mobileNumber: string;
  settings: ClubSettingsView;
}): Promise<PublicReservation> {
  const { reservation, customer, room } = await findVerifiedReservation(
    params.reference,
    params.mobileNumber,
  );

  return toPublicReservation(reservation as never, customer, room, params.settings);
}

export async function getReservationByAccessToken(
  reference: string,
  token: string,
  settings: ClubSettingsView,
): Promise<PublicReservation | null> {
  await connectToDatabase();
  if (!token || token.length < 20) return null;

  const reservation = await Reservation.findOne({
    reservationReference: normalizeReference(reference),
    accessToken: token,
  })
    .populate("customer")
    .populate("room")
    .lean();

  if (!reservation) return null;

  const customer = reservation.customer as unknown as {
    fullName: string;
    mobileNumber: string;
    email: string | null;
  } | null;
  const room = reservation.room as unknown as {
    slug: string;
    name: string;
    categorySlug: string;
    capacity: number;
    hourlyRate: number;
    coverImage?: string | null;
    images?: string[];
  } | null;

  if (!customer || !room) return null;
  return toPublicReservation(reservation as never, customer, room, settings);
}

export type CancellationResult = {
  mode: "CANCELLED" | "REQUESTED";
  reservation: PublicReservation;
  message: string;
};

export async function requestCancellation(params: {
  reference: string;
  mobileNumber: string;
  reason?: string;
  settings: ClubSettingsView;
}): Promise<CancellationResult> {
  const { settings } = params;
  const { reservation, customer, room } = await findVerifiedReservation(
    params.reference,
    params.mobileNumber,
  );

  const status = reservation.status as ReservationStatus;

  if (status === "CANCELLED" || status === "REJECTED" || status === "EXPIRED") {
    throw new ConflictError("This reservation is already closed.");
  }
  if (status === "COMPLETED" || status === "NO_SHOW") {
    throw new ConflictError("This reservation can no longer be cancelled.");
  }
  if (status === "CHECKED_IN") {
    throw new AppError("You have already checked in — please speak to our staff.", {
      statusCode: 409,
      code: "ALREADY_CHECKED_IN",
    });
  }
  if (reservation.cancellationRequest?.status === "PENDING") {
    throw new ConflictError("A cancellation request is already awaiting approval.");
  }

  const hoursUntilStart = (reservation.startAt.getTime() - Date.now()) / 3_600_000;
  if (hoursUntilStart < 0) {
    throw new ConflictError("This reservation's start time has already passed.");
  }

  const reason = blankToNull(params.reason ?? null);
  const withinCutoff = hoursUntilStart < settings.cancellationCutoffHours;

  if (withinCutoff) {
    // Inside the cutoff window the policy requires staff approval.
    const updated = await Reservation.findOneAndUpdate(
      { _id: reservation._id, status: { $in: ["PENDING", "CONFIRMED"] } },
      {
        $set: {
          "cancellationRequest.status": "PENDING",
          "cancellationRequest.reason": reason,
          "cancellationRequest.requestedAt": new Date(),
        },
      },
      { new: true },
    );

    if (!updated) throw new ConflictError("This reservation changed. Please refresh and try again.");

    logger.info("reservations.cancel", "Cancellation request raised for approval", {
      reference: updated.reservationReference,
      hoursUntilStart: Number(hoursUntilStart.toFixed(2)),
    });

    const refreshed = await findVerifiedReservation(params.reference, params.mobileNumber);

    return {
      mode: "REQUESTED",
      reservation: toPublicReservation(
        refreshed.reservation as never,
        refreshed.customer,
        refreshed.room,
        settings,
      ),
      message:
        `This booking starts in under ${settings.cancellationCutoffHours} hours, so your request needs staff approval. ` +
        `We will contact you on your registered number.`,
    };
  }

  // Outside the cutoff: cancel immediately, per policy.
  const cancelledAt = new Date();
  const updated = await Reservation.findOneAndUpdate(
    { _id: reservation._id, status: { $in: ["PENDING", "CONFIRMED"] } },
    {
      $set: {
        status: "CANCELLED",
        cancelledAt,
        cancellationReason: reason ?? "Cancelled by customer",
        "cancellationRequest.status": "APPROVED",
        "cancellationRequest.reason": reason,
        "cancellationRequest.requestedAt": cancelledAt,
        "cancellationRequest.decidedAt": cancelledAt,
      },
      $push: {
        statusHistory: {
          from: reservation.status,
          to: "CANCELLED",
          changedAt: cancelledAt,
          actorType: "CUSTOMER",
          reason: reason ?? "Cancelled by customer via website",
        },
      },
    },
    { new: true },
  );

  if (!updated) throw new ConflictError("This reservation changed. Please refresh and try again.");

  // Release the held slots so the room becomes bookable again.
  await RoomSlotLock.deleteMany({ reservation: updated._id }).catch((error) => {
    logger.error("reservations.cancel", "Failed to release slot locks", error);
  });

  logger.info("reservations.cancel", "Reservation cancelled by customer", {
    reference: updated.reservationReference,
  });

  return {
    mode: "CANCELLED",
    reservation: toPublicReservation(updated as never, customer, room, settings),
    message: "Your reservation has been cancelled. The room is now released.",
  };
}

/** Amount actually collected so far, for staff-facing screens (Phase 3). */
export async function getCollectedAmount(reservationId: string): Promise<number> {
  await connectToDatabase();
  const payments = await Payment.find({
    reservation: reservationId,
    paymentStatus: { $in: ["PAID", "PARTIALLY_PAID"] },
  })
    .select("amount")
    .lean<Array<{ amount: number }>>();
  return payments.reduce((total, payment) => total + payment.amount, 0);
}

/** "₱1,500.00" — used by server components that render prices in text. */
export function formatAmount(centavos: number): string {
  return formatMoney(centavos);
}

