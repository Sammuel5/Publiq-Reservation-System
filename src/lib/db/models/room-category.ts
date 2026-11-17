import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * RoomCategory — admin-configurable room tiers (e.g. Standard, VIP, Premium VIP,
 * Private Entertainment Area). Rooms reference a category by slug so that labels
 * and ordering can change without touching room documents.
 */

const roomCategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 60,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be kebab-case"],
    },
    description: { type: String, maxlength: 500, default: null },
    /** Accent used for badges in the UI. */
    accent: {
      type: String,
      enum: ["gold", "purple", "neutral"],
      default: "gold",
    },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "room_categories",
    toJSON: { virtuals: true, versionKey: false },
  },
);

roomCategorySchema.index({ slug: 1 }, { unique: true, name: "uniq_slug" });
roomCategorySchema.index({ isActive: 1, sortOrder: 1 });

export type RoomCategoryDocument = InferSchemaType<typeof roomCategorySchema>;

export const RoomCategory: Model<RoomCategoryDocument> =
  (models.RoomCategory as Model<RoomCategoryDocument>) ??
  model<RoomCategoryDocument>("RoomCategory", roomCategorySchema);
