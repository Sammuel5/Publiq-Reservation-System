import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

/**
 * Payment — money actually collected at the club.
 *
 * Deliberately separate from `Reservation.estimatedAmount`:
 * estimated cost is a quote, a Payment is cash in the drawer. Nothing in the
 * system ever flips a reservation to "paid" automatically.
 *
 * MONEY: `amount` is an integer number of centavos.
 */

export const PAYMENT_METHODS = ["CASH", "GCASH", "MAYA", "OTHER"] as const;
export const PAYMENT_STATUSES = ["UNPAID", "PARTIALLY_PAID", "PAID", "REFUNDED"] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const paymentSchema = new Schema(
  {
    reservation: {
      type: Schema.Types.ObjectId,
      ref: "Reservation",
      required: true,
      index: true,
    },
    /** Integer centavos of the amount received in this transaction. */
    amount: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "amount must be an integer number of centavos",
      },
    },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      required: true,
      default: "PAID",
    },
    paymentDate: { type: Date, required: true, default: () => new Date() },
    referenceNumber: { type: String, maxlength: 120, default: null },
    notes: { type: String, maxlength: 1000, default: null },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: "AdminUser",
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "payments",
    toJSON: { virtuals: true, versionKey: false },
  },
);

paymentSchema.index({ reservation: 1, paymentDate: -1 });
paymentSchema.index({ paymentDate: -1 });
paymentSchema.index({ paymentStatus: 1, paymentDate: -1 });

export type PaymentDocument = InferSchemaType<typeof paymentSchema>;

export const Payment: Model<PaymentDocument> =
  (models.Payment as Model<PaymentDocument>) ??
  model<PaymentDocument>("Payment", paymentSchema);
