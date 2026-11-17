import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * ClubSettings — single-document configuration that drives both the customer
 * website and business rules (operating hours, booking limits, cancellation
 * policy, pending-reservation expiry).
 *
 * Exactly one document exists (`singleton: true` with a unique index). Code
 * reads it through `getClubSettings()`, which lazily creates sane defaults so
 * the public site never renders with missing business information.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const clubSettingsSchema = new Schema(
  {
    singleton: { type: Boolean, default: true, immutable: true },

    clubName: { type: String, required: true, trim: true, maxlength: 120 },
    logoUrl: { type: String, default: null },
    tagline: { type: String, maxlength: 200, default: null },
    contactNumber: { type: String, required: true, trim: true, maxlength: 40 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"],
    },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    mapUrl: { type: String, default: null },

    /** 0 = Sunday … 6 = Saturday. */
    operatingDays: {
      type: [Number],
      default: [0, 1, 2, 3, 4, 5, 6],
      validate: {
        validator: (days: number[]) =>
          days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: "operatingDays must be integers 0-6",
      },
    },
    openingTime: { type: String, required: true, default: "21:00", match: HHMM },
    closingTime: { type: String, required: true, default: "04:00", match: HHMM },

    defaultDuration: { type: Number, default: 120, min: 30, max: 720 },
    minimumDuration: { type: Number, default: 60, min: 30, max: 720 },

    /** How long an unapproved PENDING reservation holds its room. */
    pendingExpirationMinutes: { type: Number, default: 120, min: 5, max: 10080 },

    cancellationPolicy: {
      type: String,
      default:
        "Cancellation requests must be made at least 4 hours before the reserved start time. Requests inside that window are subject to management approval.",
      maxlength: 2000,
    },
    /** Hours before start time after which a customer self-cancel needs approval. */
    cancellationCutoffHours: { type: Number, default: 4, min: 0, max: 168 },

    timezone: { type: String, default: "Asia/Manila", maxlength: 64 },
    currency: { type: String, default: "PHP", maxlength: 8 },

    socials: {
      facebook: { type: String, default: null },
      instagram: { type: String, default: null },
      tiktok: { type: String, default: null },
    },
  },
  {
    timestamps: true,
    collection: "club_settings",
    toJSON: { virtuals: true, versionKey: false },
  },
);

clubSettingsSchema.index({ singleton: 1 }, { unique: true, name: "uniq_singleton" });

export type ClubSettingsDocument = InferSchemaType<typeof clubSettingsSchema>;

export const ClubSettings: Model<ClubSettingsDocument> =
  (models.ClubSettings as Model<ClubSettingsDocument>) ??
  model<ClubSettingsDocument>("ClubSettings", clubSettingsSchema);
