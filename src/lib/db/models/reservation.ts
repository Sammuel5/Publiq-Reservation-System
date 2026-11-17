import { randomBytes } from "node:crypto";
import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * Reservation — the core business document.
 *
 * TIME MODEL
 * - `reservationDate` ("YYYY-MM-DD") + `startTime` / `endTime` ("HH:mm") are the
 *   club-local business values that staff and customers read.
 * - `startAt` / `endAt` are the corresponding UTC instants. All overlap and
 *   availability queries use these, so results never depend on server timezone.
 * - `durationMinutes` is authoritative for pricing (never recomputed from
 *   browser input).
 *
 * MONEY: `estimatedAmount` is an integer number of centavos. It is always
 * calculated on the server from the room's current hourly rate.
 */

export const RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "REJECTED",
  "CANCELLED",
  "CHECKED_IN",
  "COMPLETED",
  "NO_SHOW",
  "EXPIRED",
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Statuses that occupy the room and therefore block availability. */
export const BLOCKING_STATUSES: ReservationStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN"];

/** Terminal statuses kept forever for reporting/history. */
export const TERMINAL_STATUSES: ReservationStatus[] = [
  "REJECTED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
  "EXPIRED",
];

export const RESERVATION_SOURCES = ["CUSTOMER", "ADMIN"] as const;

const statusHistoryEntrySchema = new Schema(
  {
    from: { type: String, enum: [...RESERVATION_STATUSES, null], default: null },
    to: { type: String, enum: RESERVATION_STATUSES, required: true },
    changedAt: { type: Date, default: () => new Date() },
    changedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    /** "CUSTOMER" for self-service cancellation, "ADMIN" for staff actions. */
    actorType: { type: String, enum: ["ADMIN", "CUSTOMER", "SYSTEM"], default: "SYSTEM" },
    reason: { type: String, maxlength: 500, default: null },
  },
  { _id: false },
);

const internalNoteSchema = new Schema(
  {
    body: { type: String, required: true, maxlength: 1000 },
    author: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

// Embedded outbox: booking state and notification intent commit in the same
// MongoDB document write, so a successful booking cannot lose its message.
const notificationSchema = new Schema({
  id: { type: String, required: true },
  channel: { type: String, enum: ["email", "sms", "staff"], required: true },
  recipient: { type: String, default: null },
  message: { type: String, required: true },
  expectedStatus: { type: String, enum: ["PENDING", "CONFIRMED"], required: true },
  expectedDate: { type: String, required: true },
  expectedTime: { type: String, required: true },
  expectedRoom: { type: String, required: true },
  state: { type: String, enum: ["pending", "sending", "sent", "failed", "skipped"], default: "pending" },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: () => new Date() },
  leaseUntil: { type: Date, default: null },
  leaseToken: { type: String, default: null },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: null },
}, { _id: false });

const reservationSchema = new Schema(
  {
    /** Human-friendly, unique public identifier, e.g. "KTV-7F3K9Q". */
    reservationReference: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },

    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    room: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      required: true,
      index: true,
    },

    /** Business-local date, "YYYY-MM-DD" in the club timezone. */
    reservationDate: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, "reservationDate must be YYYY-MM-DD"],
    },
    startTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:mm"],
    },
    endTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "endTime must be HH:mm"],
    },
    /** UTC instants used for all availability math. */
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 30, max: 720 },

    guestCount: { type: Number, required: true, min: 1, max: 100 },

    /** Integer centavos, computed server-side. */
    estimatedAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "PHP" },

    specialRequests: { type: String, maxlength: 1000, default: null },

    status: {
      type: String,
      enum: RESERVATION_STATUSES,
      required: true,
      default: "PENDING",
      index: true,
    },
    statusHistory: { type: [statusHistoryEntrySchema], default: [] },

    internalNotes: { type: [internalNoteSchema], default: [] },

    notifications: { type: [notificationSchema], default: [], select: false },

    /** Pending holds block the room until this instant (admin-configurable). */
    pendingExpiresAt: { type: Date, default: null, index: true },

    source: { type: String, enum: RESERVATION_SOURCES, default: "CUSTOMER" },
    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },

    confirmedAt: { type: Date, default: null },
    checkedInAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, maxlength: 500, default: null },

    /** Idempotency key derived from the submission signature (double-submit guard). */
    submissionKey: { type: String, default: null },

    /**
     * One-time access token for the post-booking confirmation page.
     * Returned to the customer exactly once, at creation. It is never listed in
     * API responses or admin tables (`select: false`), so a confirmation URL
     * cannot be guessed from a reference number.
     */
    accessToken: {
      type: String,
      select: false,
      default: () => randomBytes(24).toString("hex"),
    },

    /**
     * Customer-initiated cancellation.
     * Outside the policy cutoff the request cancels immediately (status →
     * CANCELLED). Inside the cutoff it becomes a PENDING request that only an
     * admin can approve — customers can never bypass the configured policy.
     */
    cancellationRequest: {
      status: {
        type: String,
        enum: ["NONE", "PENDING", "APPROVED", "DECLINED"],
        default: "NONE",
      },
      reason: { type: String, maxlength: 500, default: null },
      requestedAt: { type: Date, default: null },
      decidedAt: { type: Date, default: null },
      decidedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
      decisionNote: { type: String, maxlength: 500, default: null },
    },
  },
  {
    timestamps: true,
    collection: "reservations",
    toJSON: { virtuals: true, versionKey: false },
  },
);

reservationSchema.index(
  { reservationReference: 1 },
  { unique: true, name: "uniq_reference" },
);

/** Primary availability query: which reservations occupy a room in a window. */
reservationSchema.index(
  { room: 1, status: 1, startAt: 1, endAt: 1 },
  { name: "room_availability" },
);

/** Daily/weekly/monthly calendar views. */
reservationSchema.index({ reservationDate: 1, status: 1, startAt: 1 });

/** Expiry sweeper: find PENDING holds whose hold has lapsed. */
reservationSchema.index(
  { status: 1, pendingExpiresAt: 1 },
  { name: "pending_expiry" },
);

reservationSchema.index({ "notifications.state": 1, "notifications.nextAttemptAt": 1 }, { name: "notification_due" });

/** Admin tables. */
reservationSchema.index({ createdAt: -1 });
reservationSchema.index({ "cancellationRequest.status": 1, startAt: 1 });
reservationSchema.index({ customer: 1, startAt: -1 });

/**
 * Double-submit protection (per customer + window).
 * Partial, not sparse: a released key is unset, and plain `null` values would
 * still collide under a unique sparse index.
 */
reservationSchema.index(
  { submissionKey: 1 },
  {
    unique: true,
    partialFilterExpression: { submissionKey: { $type: "string" } },
    name: "uniq_submission_key",
  },
);

reservationSchema.pre("validate", function (next) {
  if (this.endAt && this.startAt && this.endAt <= this.startAt) {
    return next(new Error("Reservation end must be after start"));
  }
  next();
});

export type ReservationDocument = InferSchemaType<typeof reservationSchema>;

export const Reservation: Model<ReservationDocument> =
  (models.Reservation as Model<ReservationDocument>) ??
  model<ReservationDocument>("Reservation", reservationSchema);
