import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * Room — a bookable KTV / entertainment space.
 *
 * MONEY: `hourlyRate` is an INTEGER number of centavos (₱1,500.00 = 150000).
 * Integers avoid floating-point drift in price calculations and are formatted
 * for display by `formatMoney`. The browser never supplies prices.
 *
 * TIME: `minimumDuration` and `slotMinutes` are minutes.
 */

export const MAINTENANCE_STATUSES = [
  "OPERATIONAL",
  "SCHEDULED",
  "IN_PROGRESS",
] as const;

const roomSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Room name is required"],
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 90,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case"],
    },
    /** References RoomCategory.slug (configurable by admins). */
    categorySlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      default: "standard",
    },
    shortDescription: { type: String, maxlength: 240, default: null },
    description: { type: String, maxlength: 2000, default: null },
    /** Image URLs from an external host (Cloudinary / UploadThing / CDN). */
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 10,
        message: "A room can have at most 10 images",
      },
    },
    coverImage: { type: String, default: null },

    capacity: {
      type: Number,
      required: true,
      min: [1, "Capacity must be at least 1"],
      max: 100,
    },
    /** Integer centavos per hour. */
    hourlyRate: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "hourlyRate must be an integer number of centavos",
      },
    },
    minimumDuration: { type: Number, default: 60, min: 30, max: 720 },
    /** Booking granularity in minutes (start times snapped to this grid). */
    slotMinutes: { type: Number, default: 30, min: 15, max: 120 },

    amenities: { type: [String], default: [] },

    /** Admin switches. */
    isActive: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
    maintenanceStatus: {
      type: String,
      enum: MAINTENANCE_STATUSES,
      default: "OPERATIONAL",
    },
    maintenanceNote: { type: String, maxlength: 500, default: null },

    sortOrder: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: "rooms",
    toJSON: { virtuals: true, versionKey: false },
  },
);

roomSchema.index({ slug: 1 }, { unique: true, name: "uniq_slug" });
roomSchema.index({ isActive: 1, isAvailable: 1, maintenanceStatus: 1 });
roomSchema.index({ categorySlug: 1, sortOrder: 1 });

/** A room can only be booked when every admin switch allows it. */
roomSchema.virtual("isBookable").get(function () {
  const self = this as unknown as {
    isActive: boolean;
    isAvailable: boolean;
    maintenanceStatus: string;
  };
  return (
    self.isActive === true &&
    self.isAvailable === true &&
    self.maintenanceStatus === "OPERATIONAL"
  );
});

export type RoomDocument = InferSchemaType<typeof roomSchema>;

export const Room: Model<RoomDocument> =
  (models.Room as Model<RoomDocument>) ?? model<RoomDocument>("Room", roomSchema);
