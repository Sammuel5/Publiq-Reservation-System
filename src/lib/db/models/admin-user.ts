import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";
import { ADMIN_ROLES } from "@/config/app";

/**
 * AdminUser — staff accounts for the dashboard.
 * There is no public registration; accounts are created by a Super Admin (or by
 * the one-off seed script for the very first Super Admin).
 */

export const adminUserSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"],
    },
    /** bcrypt hash only — the plaintext password is never persisted. */
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ADMIN_ROLES,
      required: true,
      default: "STAFF",
    },
    isActive: { type: Boolean, default: true },

    /** Brute-force throttling / auditing. */
    failedLoginAttempts: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "admin_users",
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        delete ret.failedLoginAttempts;
        delete ret.lockedUntil;
        return ret;
      },
    },
  },
);

adminUserSchema.index({ email: 1 }, { unique: true, name: "uniq_email" });
adminUserSchema.index({ role: 1, isActive: 1 });

adminUserSchema.virtual("isLocked").get(function () {
  const self = this as unknown as { lockedUntil?: Date | null };
  return Boolean(self.lockedUntil && self.lockedUntil.getTime() > Date.now());
});

export type AdminUserDocument = InferSchemaType<typeof adminUserSchema>;

export const AdminUser: Model<AdminUserDocument> =
  (models.AdminUser as Model<AdminUserDocument>) ??
  model<AdminUserDocument>("AdminUser", adminUserSchema);
