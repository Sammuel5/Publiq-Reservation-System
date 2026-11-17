import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * Customer — one record per real person, reused across reservations.
 * Identity is keyed on the normalized mobile number (e.g. 0917 123 4567,
 * +63 917 123 4567 and 9171234567 all resolve to +639171234567).
 *
 * Customers never log in; these records exist only so the club can recognise
 * returning guests and show booking history.
 */

const customerSchema = new Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    /** E.164-style normalized value: +639XXXXXXXXX. */
    mobileNumber: {
      type: String,
      required: [true, "Mobile number is required"],
      trim: true,
      match: [/^\+[1-9]\d{7,14}$/, "Mobile number must be normalized to E.164"],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"],
      default: null,
    },
    /** Latest name spelling supplied by staff (kept for display consistency). */
    notes: { type: String, maxlength: 1000, default: null },
  },
  {
    timestamps: true,
    collection: "customers",
    toJSON: { virtuals: true, versionKey: false },
  },
);

customerSchema.index({ mobileNumber: 1 }, { unique: true, name: "uniq_mobile" });
customerSchema.index({ fullName: 1 });
customerSchema.index({ email: 1 }, { sparse: true });
customerSchema.index({ createdAt: -1 });

export type CustomerDocument = InferSchemaType<typeof customerSchema>;

export const Customer: Model<CustomerDocument> =
  (models.Customer as Model<CustomerDocument>) ??
  model<CustomerDocument>("Customer", customerSchema);
