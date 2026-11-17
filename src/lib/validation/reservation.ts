import { z } from "zod";
import { isDateString } from "@/lib/utils/datetime";
import { normalizeMobileNumber } from "@/lib/utils/normalize";
import { MAX_ADVANCE_DAYS } from "@/lib/services/availability";

/**
 * Public booking validation. Shared by the wizard (instant feedback) and the
 * API (authoritative). The server never trusts any of these values — prices and
 * availability are always recalculated.
 */

export const mobileField = z
  .string({ required_error: "Mobile number is required." })
  .trim()
  .min(7, "Enter a valid mobile number.")
  .max(20, "That number is too long.")
  .refine((value) => normalizeMobileNumber(value) !== null, {
    message: "Enter a valid PH mobile number (e.g. 0917 123 4567).",
  });

export const referenceField = z
  .string({ required_error: "Reservation reference is required." })
  .trim()
  .min(4, "Enter your reservation reference.")
  .max(20, "That reference is too long.")
  .transform((value) => value.toUpperCase().replace(/\s+/g, ""));

export const dateField = z
  .string({ required_error: "Choose a date." })
  .trim()
  .refine(isDateString, { message: "Choose a valid date." });

export const timeField = z
  .string({ required_error: "Choose a start time." })
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Choose a valid start time.");

export const durationField = z.coerce
  .number({ invalid_type_error: "Choose a duration." })
  .int("Choose a duration.")
  .min(30, "Minimum booking is 30 minutes.")
  .max(720, "Maximum booking is 12 hours.");

export const guestCountField = z.coerce
  .number({ invalid_type_error: "Enter the number of guests." })
  .int("Enter a whole number of guests.")
  .min(1, "At least 1 guest is required.")
  .max(100, "For groups over 100, please call the club.");

export const createReservationSchema = z.object({
  roomSlug: z.string().trim().min(1, "Choose a room.").max(90),
  date: dateField,
  startTime: timeField,
  durationMinutes: durationField,
  fullName: z
    .string({ required_error: "Full name is required." })
    .trim()
    .min(2, "Enter your full name.")
    .max(120, "That name is too long.")
    .regex(/^[\p{L}\p{M}'.\-\s]+$/u, "Use letters, spaces, hyphens and apostrophes only."),
  mobileNumber: mobileField,
  email: z
    .union([z.string().trim().email("Enter a valid email address.").max(254), z.literal("")])
    .optional(),
  guestCount: guestCountField,
  specialRequests: z
    .string()
    .trim()
    .max(1000, "Please keep special requests under 1000 characters.")
    .optional(),
  acceptPolicy: z.literal(true, {
    errorMap: () => ({ message: "Please accept the cancellation policy to continue." }),
  }),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const lookupSchema = z.object({
  reference: referenceField,
  mobileNumber: mobileField,
});

export type LookupInput = z.infer<typeof lookupSchema>;

export const cancellationSchema = z.object({
  reference: referenceField,
  mobileNumber: mobileField,
  reason: z
    .string()
    .trim()
    .max(500, "Please keep the reason under 500 characters.")
    .optional(),
});

export type CancellationInput = z.infer<typeof cancellationSchema>;

export const availabilityQuerySchema = z.object({
  date: dateField,
  duration: durationField.optional(),
  startTime: timeField.optional(),
  guests: z.coerce.number().int().min(1).max(100).optional(),
});

export const MAX_ADVANCE = MAX_ADVANCE_DAYS;
