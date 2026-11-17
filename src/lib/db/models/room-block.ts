import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * RoomBlock — an admin-created hold on a room for a specific window
 * (maintenance windows, private events, holidays).
 *
 * `room: null` means the block applies to the whole venue (all rooms).
 * Blocks are stored as UTC instants so overlap checks are timezone-proof.
 */

const roomBlockSchema = new Schema(
  {
    room: {
      type: Schema.Types.ObjectId,
      ref: "Room",
      default: null,
      index: true,
    },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    reason: { type: String, maxlength: 300, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    /** Soft-delete so the audit trail survives. */
    isActive: { type: Boolean, default: true },
    /** Who closed the window early, and when. Cleared again if it is reopened. */
    closedBy: { type: Schema.Types.ObjectId, ref: "AdminUser", default: null },
    closedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "room_blocks",
    toJSON: { virtuals: true, versionKey: false },
  },
);

roomBlockSchema.index({ room: 1, startAt: 1, endAt: 1 });
roomBlockSchema.index({ isActive: 1, startAt: 1 });

roomBlockSchema.pre("validate", function (next) {
  if (this.startAt && this.endAt && this.endAt <= this.startAt) {
    return next(new Error("Block end must be after block start"));
  }
  next();
});

export type RoomBlockDocument = InferSchemaType<typeof roomBlockSchema>;

export const RoomBlock: Model<RoomBlockDocument> =
  (models.RoomBlock as Model<RoomBlockDocument>) ??
  model<RoomBlockDocument>("RoomBlock", roomBlockSchema);
