import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * RoomSlotLock — database-level double-booking guard.
 *
 * A reservation occupies one or more fixed-length slots. Each occupied slot is
 * written as a separate document whose unique index `(room, slotStart)` makes a
 * second concurrent write for the same room+slot fail atomically — no
 * transaction or replica set required, so this works on any MongoDB deployment
 * (including Atlas free/shared tiers).
 *
 * Locks are released (deleted) when a reservation stops blocking the room:
 * rejected, cancelled, expired, completed or no-show.
 *
 * Phase 1 creates the model and indexes; the booking engine (Phase 4) writes
 * and releases these documents inside `reservationService`.
 */

const slotLockSchema = new Schema(
  {
    room: { type: Schema.Types.ObjectId, ref: "Room", required: true },
    /** UTC instant of the slot boundary (start of slot). */
    slotStart: { type: Date, required: true },
    slotEnd: { type: Date, required: true },
    reservation: {
      type: Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
    },
    status: { type: String, default: "PENDING" },
  },
  {
    timestamps: true,
    collection: "room_slot_locks",
    toJSON: { virtuals: true, versionKey: false },
  },
);

slotLockSchema.index(
  { room: 1, slotStart: 1 },
  { unique: true, name: "uniq_room_slot" },
);
slotLockSchema.index({ reservation: 1 });
slotLockSchema.index({ slotStart: 1 });

export type RoomSlotLockDocument = InferSchemaType<typeof slotLockSchema>;

export const RoomSlotLock: Model<RoomSlotLockDocument> =
  (models.RoomSlotLock as Model<RoomSlotLockDocument>) ??
  model<RoomSlotLockDocument>("RoomSlotLock", slotLockSchema);
