import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * AdminSession — server-side session records.
 *
 * The browser holds an opaque 256-bit random token in an httpOnly cookie.
 * Only the SHA-256 hash of that token is stored here, so a database leak cannot
 * be replayed as a live session, and every session can be revoked instantly
 * (logout, password change, account deactivation).
 *
 * The TTL index makes expired sessions self-clean; application code still checks
 * `expiresAt` on every request so behaviour is identical on deployments where
 * the TTL monitor is delayed by up to ~60 seconds.
 */

const sessionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: () => new Date() },
    userAgent: { type: String, maxlength: 512, default: null },
    /** Truncated network hint for auditing — never a full IP address. */
    ipHint: { type: String, maxlength: 64, default: null },
    revokedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "admin_sessions",
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.tokenHash;
        return ret;
      },
    },
  },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_expiry" });
sessionSchema.index({ user: 1, expiresAt: -1 });

export type AdminSessionDocument = InferSchemaType<typeof sessionSchema>;

export const AdminSession: Model<AdminSessionDocument> =
  (models.AdminSession as Model<AdminSessionDocument>) ??
  model<AdminSessionDocument>("AdminSession", sessionSchema);
