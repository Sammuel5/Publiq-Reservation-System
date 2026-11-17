import { z } from "zod";
import { isDateString } from "@/lib/utils/datetime";
import { normalizeMobileNumber, normalizeEmail } from "@/lib/utils/normalize";
import { parsePesosToCentavos } from "@/lib/utils/money";
import { ADMIN_ROLES } from "@/config/app";
import { fieldErrorsFromZod } from "@/lib/validation/form-errors";
import { ValidationError } from "@/lib/errors";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Admin-side validation (Phase 3).
 *
 * Everything the admin console writes goes through one of these schemas first.
 * A few principles are deliberate:
 *
 * - **Money is entered in pesos, stored in centavos.** The form field takes a
 *   human string ("1,800.50"), the schema turns it into an integer number of
 *   centavos, and the database never sees a float.
 * - **Ids are validated, not trusted.** `objectIdField` rejects anything that is
 *   not a 24-char hex string *before* it reaches Mongoose, so a malformed id is
 *   a 422 rather than a CastError deep inside a query.
 * - **Free text is length-capped and control-character-free**, matching the
 *   schema limits so a user gets a friendly message instead of a Mongo error.
 * - **Filters are parsed, not interpolated.** `escapeRegex` (see
 *   `lib/services/admin/shared.ts`) is applied to every search term, and status
 *   enums are whitelisted, so user input can never widen a query.
 */

/**
 * A blank query parameter is the same question as an absent one.
 *
 * The console's filters are plain GET forms, so an untouched `<select>` still
 * submits `status=&room=`. Handed to the schema as-is, those empty strings fail
 * the whole query, and a page that falls back to its default view reads to the
 * operator as "my filter did nothing". Stripping blanks keeps
 * `?q=NK-4F2K9Q&status=` a working bookmark.
 */
export function filterParams(
  input: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const kept: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      const entries = value.filter((entry) => entry !== "");
      if (entries.length > 0) kept[key] = entries;
    } else if (value !== "") {
      kept[key] = value;
    }
  }
  return kept;
}

export const objectIdField = z
  .string({ required_error: "An id is required." })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "That reference is not valid.");

const OPTIONAL_ID = z
  .union([objectIdField, z.literal(""), z.null()])
  .optional()
  .transform((value) => (value ? value : null));

const nameField = (label: string, max = 120) =>
  z
    .string({ required_error: `${label} is required.` })
    .trim()
    .min(2, `${label} is too short.`)
    .max(max, `${label} is too long.`)
    .regex(/^[\p{L}\p{M}\p{N}'".\-&#\s]+$/u, `${label} contains characters we cannot store.`);

const textAreaField = (max: number) =>
  z.string().trim().max(max, `Please keep this under ${max} characters.`);

/**
 * A blank slug means "derive it from the name", which is what the room and
 * category forms promise under the field — so an empty string has to parse, not
 * fail the kebab-case rule. Anything else is held to it.
 */
const slugField = (label: string, max = 90) =>
  z
    .string({ required_error: `${label} is required.` })
    .trim()
    .transform((value) => (value.length === 0 ? undefined : value))
    .pipe(z.union([z.undefined(), z.string().max(max).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${label} must be kebab-case (lowercase words separated by hyphens).`)]))
    .transform((value) => (value ? value.toLowerCase() : undefined));

/** Accepts "1,800", "1800.50" → integer centavos. */
const pesosField = (label: string, options: { min?: number; max?: number } = {}) =>
  z
    .string({ required_error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .transform((value, ctx) => {
      const centavos = parsePesosToCentavos(value.replace(/\s+/g, ""));
      if (centavos === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Enter ${label} as an amount, e.g. 1,800.00.` });
        return z.NEVER;
      }
      if (options.min !== undefined && centavos < options.min) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} cannot be lower than the minimum.` });
        return z.NEVER;
      }
      if (options.max !== undefined && centavos > options.max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is too large.` });
        return z.NEVER;
      }
      return centavos;
    });

export const dateField = z
  .string({ required_error: "Choose a date." })
  .trim()
  .refine(isDateString, { message: "Choose a valid date (YYYY-MM-DD)." });

export const timeField = z
  .string({ required_error: "Choose a time." })
  .trim()
  .refine((value) => HHMM.test(value), { message: "Choose a valid time (24-hour HH:mm)." });

/**
 * Checkboxes submit booleans over JSON but strings in a plain form post, and
 * `z.coerce.boolean()` would happily turn "false" into true. Be explicit.
 */
export const boolField = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", "on", "off", "yes", "no"]), z.literal("")])
  .optional()
  .transform((value) => value === true || value === "true" || value === "1" || value === "on" || value === "yes")
  .default(false);

const durationField = z.coerce
  .number({ invalid_type_error: "Choose a duration in minutes." })
  .int("Use whole minutes.")
  .min(30, "Minimum 30 minutes.")
  .max(720, "Maximum 12 hours.");

const guestField = z.coerce
  .number({ invalid_type_error: "Enter the number of guests." })
  .int("Enter a whole number of guests.")
  .min(1, "At least 1 guest.")
  .max(100, "Maximum 100 guests.");

/**
 * A link field that survives a GET → edit → PUT round trip: `null` (stored but
 * never filled in), `""` (cleared in the form) and a real URL are all valid, and
 * anything else is refused with a message naming the field.
 */
const urlField = (label: string) =>
  z
    .union([
      z.string().trim().url(`Enter a valid ${label} URL (https://…).`).max(500),
      z.literal(""),
      z.null(),
    ])
    .optional()
    .transform((value) => (value ? value : null));

const mobileField = z
  .string({ required_error: "Mobile number is required." })
  .trim()
  .min(7, "Enter a valid mobile number.")
  .max(20, "That number is too long.")
  .refine((value) => normalizeMobileNumber(value) !== null, {
    message: "Enter a valid PH mobile number (e.g. 0917 123 4567).",
  });

// --------------------------------------------------------------- board query --

export const RESERVATION_STATUSES_QUERY = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "NO_SHOW",
  "EXPIRED",
  "ATTENTION",
] as const;

/**
 * Query string for `/admin/reservations`. Everything is optional so the page is
 * a valid landing state on its own (`?view=today` is the default).
 */
export const reservationQuerySchema = z.object({
  view: z.enum(["today", "upcoming", "all"]).default("today"),
  from: dateField.optional(),
  to: dateField.optional(),
  status: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      const allowed = new Set<string>(RESERVATION_STATUSES_QUERY);
      const list = value === undefined ? [] : typeof value === "string" ? [value] : value;
      return list.filter((entry) => allowed.has(entry));
    }),
  room: OPTIONAL_ID,
  source: z.enum(["CUSTOMER", "ADMIN"]).optional(),
  q: z.string().trim().max(80).optional().transform((value) => value || undefined),
  sort: z.enum(["startAt", "createdAt", "amount"]).default("startAt"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(5).max(100).default(25),
})
  .superRefine(refineDateRange);

export type ReservationQuery = z.infer<typeof reservationQuerySchema>;

/**
 * Widest date window an admin list query may ask for.
 *
 * Without a ceiling, `?view=all&from=1900-01-01&to=2100-01-01` is a perfectly
 * valid query that happens to walk the entire reservation collection and build a
 * page out of it. A hundred and twenty days is more than any reasonable "review
 * last season" request, and it keeps `reservationDate` doing the work of an
 * index range scan instead of a collection scan.
 */
export const DATE_RANGE_LIMIT_DAYS = 120;

/**
 * Cross-field guard for the `from`/`to` pair every list screen accepts, so a
 * wild range is a 422 with a field error rather than an enormous scan.
 */
function refineDateRange(value: { from?: string; to?: string }, ctx: z.RefinementCtx): void {
  if (!value.from || !value.to) return;

  if (value.from > value.to) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "The end date is before the start date.",
    });
    return;
  }

  const days = (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000;
  if (days > DATE_RANGE_LIMIT_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: `Narrow the range to ${DATE_RANGE_LIMIT_DAYS} days or fewer — it is currently ${Math.round(days)} days.`,
    });
  }
}

// ---------------------------------------------------------------- transitions --

export const RESERVATION_ACTIONS = [
  "CONFIRM",
  "REJECT",
  "CHECK_IN",
  "COMPLETE",
  "NO_SHOW",
  "CANCEL",
  "EXPIRE",
] as const;

export const reservationActionSchema = z.object({
  action: z.enum(RESERVATION_ACTIONS, {
    errorMap: () => ({ message: "That action is not available." }),
  }),
  reason: textAreaField(500).optional(),
});

export type ReservationActionInput = z.infer<typeof reservationActionSchema>;

export const cancellationDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "DECLINED"]),
  note: textAreaField(500).optional(),
});

export const internalNoteSchema = z.object({
  body: z
    .string({ required_error: "Write a note first." })
    .trim()
    .min(2, "That note is too short.")
    .max(1000, "Please keep notes under 1000 characters."),
});

/** Staff-side edit of the customer details on a live reservation. */
export const reservationEditSchema = z
  .object({
    fullName: nameField("Guest name", 120),
    mobileNumber: mobileField,
    email: z
      .union([z.string().trim().max(254), z.literal("")])
      .optional()
      .transform((value) => {
        if (!value) return null;
        const email = normalizeEmail(value);
        if (!email) {
          throw new z.ZodError([
            { code: z.ZodIssueCode.custom, path: ["email"], message: "Enter a valid email address." },
          ]);
        }
        return email;
      }),
    guestCount: guestField,
    specialRequests: textAreaField(1000).optional(),
    internalNote: textAreaField(1000).optional(),
  })
  .strict();

export type ReservationEditInput = z.infer<typeof reservationEditSchema>;

/** Reschedule / re-room a booking. Availability and price are recomputed. */
export const reservationMoveSchema = z
  .object({
    roomId: objectIdField,
    date: dateField,
    startTime: timeField,
    durationMinutes: durationField,
    reason: textAreaField(500).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.reason), {
    path: ["reason"],
    message: "Tell us why the booking moved — it goes in the audit trail.",
  });

export type ReservationMoveInput = z.infer<typeof reservationMoveSchema>;

// --------------------------------------------------------------------- rooms ---

export const roomCreateSchema = z
  .object({
    name: nameField("Room name", 80),
    slug: slugField("Slug", 90).optional(),
    categorySlug: z.string().trim().min(2).max(60).transform((value) => value.toLowerCase()),
    shortDescription: textAreaField(240).optional(),
    description: textAreaField(2000).optional(),
    capacity: z.coerce.number().int().min(1).max(100),
    hourlyRate: pesosField("Hourly rate", { min: 0, max: 10_000_000 }),
    minimumDuration: durationField,
    slotMinutes: z.coerce.number().int().min(15).max(120).default(30),
    amenities: z
      .union([z.string(), z.string().array()])
      .optional()
      .transform((value) => {
        const list = value === undefined ? [] : Array.isArray(value) ? value : value.split(",");
        return list
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 24)
          .map((item) => item.slice(0, 60));
      }),
    images: z
      .union([z.string(), z.string().array()])
      .optional()
      .transform((value) => {
        const list = value === undefined ? [] : Array.isArray(value) ? value : value.split("\n");
        return list
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
          .slice(0, 10);
      }),
    coverImage: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((value) => (value ? value : null)),
    isActive: boolField.default(true),
    isAvailable: boolField.default(true),
    maintenanceStatus: z.enum(["OPERATIONAL", "SCHEDULED", "IN_PROGRESS"]).default("OPERATIONAL"),
    maintenanceNote: textAreaField(500).optional(),
  })
  .strict();

export const roomUpdateSchema = roomCreateSchema.partial().extend({}).strict();

export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type RoomUpdateInput = z.infer<typeof roomUpdateSchema>;

export const roomOrderSchema = z
  .object({
    /** Full ordered list of room ids — the server rewrites sortOrder from it. */
    order: z.array(objectIdField).min(1).max(200),
  })
  .strict();

export const categorySchema = z
  .object({
    name: nameField("Category name", 60),
    slug: slugField("Slug", 60).optional(),
    description: textAreaField(500).optional(),
    accent: z.enum(["gold", "purple", "neutral"]).default("gold"),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
    isActive: boolField.default(true),
  })
  .strict();

export const categoryUpdateSchema = categorySchema.partial().strict();

export type CategoryInput = z.infer<typeof categorySchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

// --------------------------------------------------------------------- blocks --

export const roomBlockCreateSchema = z
  .object({
    /** Empty/absent blocks the whole venue. */
    roomId: OPTIONAL_ID,
    date: dateField,
    startTime: timeField,
    endTime: timeField,
    reason: textAreaField(300).optional(),
    /** Proceed even though existing bookings collide with the window. */
    force: boolField.default(false),
  })
  .strict()
  .refine((value) => value.startTime !== value.endTime, {
    path: ["endTime"],
    message: "Pick an end time after the start time.",
  });

export type RoomBlockCreateInput = z.infer<typeof roomBlockCreateSchema>;

export const roomBlockQuerySchema = z
  .object({
    from: dateField.optional(),
    to: dateField.optional(),
    room: OPTIONAL_ID,
  })
  .superRefine(refineDateRange);

// ------------------------------------------------------------------ customers --

export const customerQuerySchema = z.object({
  q: z.string().trim().max(80).optional().transform((value) => value || undefined),
  sort: z.enum(["recent", "visits", "spend", "name"]).default("recent"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(5).max(100).default(25),
});

export const customerUpdateSchema = z
  .object({
    fullName: nameField("Customer name", 120).optional(),
    email: z
      .union([z.string().trim().max(254), z.literal("")])
      .optional()
      .transform((value) => (value ? (normalizeEmail(value) ?? "") : null)),
    notes: textAreaField(1000).optional(),
  })
  .strict();

// ------------------------------------------------------------------- payments --

export const paymentCreateSchema = z
  .object({
    amount: pesosField("Amount", { min: 1, max: 100_000_000 }),
    paymentMethod: z.enum(["CASH", "GCASH", "MAYA", "OTHER"]),
    paymentStatus: z.enum(["PAID", "PARTIALLY_PAID", "REFUNDED"]).default("PAID"),
    referenceNumber: textAreaField(120).optional(),
    notes: textAreaField(1000).optional(),
  })
  .strict();

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

export const paymentQuerySchema = z.object({
  from: dateField.optional(),
  to: dateField.optional(),
  method: z.enum(["CASH", "GCASH", "MAYA", "OTHER", "REFUNDED"]).optional(),
  q: z.string().trim().max(80).optional().transform((value) => value || undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(5).max(100).default(25),
})
  .superRefine(refineDateRange);

// ------------------------------------------------------------------- settings --

export const settingsSchema = z
  .object({
    clubName: nameField("Club name", 120),
    tagline: textAreaField(200).optional(),
    contactNumber: z
      .string({ required_error: "Contact number is required." })
      .trim()
      .min(7, "Enter a reachable phone number.")
      .max(40),
    email: z.string().trim().email("Enter a valid email address.").max(254),
    address: z
      .string({ required_error: "Address is required." })
      .trim()
      .min(5, "Enter the full address.")
      .max(300),
    mapUrl: urlField("map"),
    logoUrl: urlField("logo"),
    openingTime: timeField,
    closingTime: timeField,
    operatingDays: z
      .union([z.string(), z.number().array(), z.string().array()])
      .optional()
      .transform((value) => {
        const raw =
          value === undefined
            ? [0, 1, 2, 3, 4, 5, 6]
            : typeof value === "string"
              ? value.split(",").map((item) => Number(item))
              : value.map(Number);
        const days = [...new Set(raw)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
        if (days.length === 0) {
          throw new z.ZodError([
            {
              code: z.ZodIssueCode.custom,
              path: ["operatingDays"],
              message: "Pick at least one operating day.",
            },
          ]);
        }
        return days.sort((a, b) => a - b);
      }),
    defaultDuration: durationField,
    minimumDuration: durationField,
    pendingExpirationMinutes: z.coerce.number().int().min(5).max(10_080),
    cancellationCutoffHours: z.coerce.number().int().min(0).max(168),
    cancellationPolicy: z
      .string({ required_error: "Write the cancellation policy." })
      .trim()
      .min(20, "The policy should be at least a sentence.")
      .max(1000),
    timezone: z
      .string({ required_error: "Timezone is required." })
      .trim()
      .min(3)
      .max(64)
      .regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+$/, "Use an IANA name such as Asia/Manila."),
    currency: z
      .string({ required_error: "Currency is required." })
      .trim()
      .regex(/^[A-Za-z]{3}$/, "Use a 3-letter ISO code, e.g. PHP.")
      .transform((value) => value.toUpperCase()),
    facebook: urlField("Facebook"),
    instagram: urlField("Instagram"),
    tiktok: urlField("TikTok"),
    /**
     * The stored document keeps these three nested under `socials`, and the
     * settings screen reads that document — so a client that posts back what it
     * got must not be rejected for using the nested spelling. The service prefers
     * the flat keys when both are present.
     */
    socials: z
      .object({
        facebook: urlField("Facebook"),
        instagram: urlField("Instagram"),
        tiktok: urlField("TikTok"),
      })
      .nullable()
      .optional(),
  })
  .strict();

/** Checked in the service so both numbers keep their inferred types. */
export function settingsDurationIssue(data: {
  minimumDuration: number;
  defaultDuration: number;
}): string | null {
  return data.minimumDuration > data.defaultDuration
    ? "The default duration must be at least the minimum duration."
    : null;
}

export type SettingsInput = z.infer<typeof settingsSchema>;

// ----------------------------------------------------------------------- team --

export const adminUserCreateSchema = z
  .object({
    name: nameField("Name", 120),
    email: z.string().trim().min(3).max(254).email("Enter a valid email address."),
    role: z.enum(ADMIN_ROLES),
    password: z.string().min(12, "Use at least 12 characters.").max(200),
  })
  .strict();

export const adminUserUpdateSchema = z
  .object({
    name: nameField("Name", 120).optional(),
    role: z.enum(ADMIN_ROLES).optional(),
    isActive: boolField.optional(),
    password: z.string().min(12, "Use at least 12 characters.").max(200).optional(),
  })
  .strict();

export type AdminUserCreateInput = z.infer<typeof adminUserCreateSchema>;
export type AdminUserUpdateInput = z.infer<typeof adminUserUpdateSchema>;

// -------------------------------------------------------------------- helpers --

// ------------------------------------------------------------ staff booking --

/**
 * Front-desk ("walk-in") booking. Same shape as the public wizard plus the two
 * things only staff may decide: create it already confirmed, and start it inside
 * the 30-minute public lead time.
 */
export const staffReservationSchema = z
  .object({
    roomSlug: z.string({ required_error: "Choose a room." }).trim().min(1).max(90),
    date: dateField,
    startTime: timeField,
    durationMinutes: durationField,
    fullName: nameField("Guest name", 120),
    mobileNumber: mobileField,
    email: z
      .union([z.string().trim().max(254), z.literal("")])
      .optional()
      .transform((value) => (value ? (normalizeEmail(value) ?? "") : "")),
    guestCount: guestField,
    specialRequests: textAreaField(1000).optional(),
    confirmNow: boolField.default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!normalizeMobileNumber(value.mobileNumber)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mobileNumber"], message: "Enter a valid mobile number." });
    }
  });

export type StaffReservationInput = z.infer<typeof staffReservationSchema>;

/** Parse `raw` with `schema`, raising the shared 422 envelope on failure. */
export function parseOr422<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError("Some fields need your attention.", {
      fields: fieldErrorsFromZod(result.error),
    });
  }
  return result.data;
}
