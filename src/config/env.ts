/**
 * Server-side environment configuration.
 *
 * Design notes:
 * - Validation is LAZY (on first access, then cached) so that `next build` never
 *   fails on a machine without runtime secrets, while any code path that actually
 *   needs a secret fails loudly and immediately with an actionable message.
 * - Nothing in this file may ever be imported by a client component. Only
 *   `NEXT_PUBLIC_*` variables are safe for the browser, and they are read
 *   through `getPublicEnv()` below.
 */
import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // MongoDB Atlas (or any MongoDB-compatible URI).
  MONGODB_URI: z
    .string()
    .min(1, "MONGODB_URI is required")
    .refine(
      (value) => value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
      "MONGODB_URI must start with mongodb:// or mongodb+srv://",
    ),
  MONGODB_DB_NAME: z.string().min(1).default("ktv_club"),

  // Auth / sessions
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(8),
  AUTH_COOKIE_NAME: z.string().min(1).default("ktv_admin_session"),
  /**
   * Override the cookie `Secure` flag. Defaults to true when NODE_ENV is
   * production, false otherwise. Only set "false" for plain-HTTP self-hosting
   * or local production-mode testing.
   */
  AUTH_COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),

  // Business defaults
  CLUB_TIMEZONE: z.string().min(1).default("Asia/Manila"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    MONGODB_URI: process.env.MONGODB_URI,
    MONGODB_DB_NAME: process.env.MONGODB_DB_NAME,
    AUTH_SESSION_TTL_HOURS: process.env.AUTH_SESSION_TTL_HOURS,
    AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME,
    AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE,
    CLUB_TIMEZONE: process.env.CLUB_TIMEZONE,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing server environment configuration:\n${details}\n` +
        `Copy .env.example to .env.local and fill in the values.`,
    );
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return getServerEnv().NODE_ENV === "production";
}

/**
 * Public (browser-safe) configuration. Only NEXT_PUBLIC_* values belong here.
 */
export function getPublicEnv() {
  return {
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    isProduction: process.env.NODE_ENV === "production",
  } as const;
}

/**
 * Seed-only configuration. Kept separate from `getServerEnv` because these
 * variables exist for the one-off admin bootstrap script and must NOT be
 * required by the running application.
 */
export function getSeedEnv() {
  const schema = z.object({
    SEED_SUPER_ADMIN_NAME: z.string().trim().min(2).max(120),
    SEED_SUPER_ADMIN_EMAIL: z.string().trim().email().max(254),
    SEED_SUPER_ADMIN_PASSWORD: z
      .string()
      .min(12, "Seed password must be at least 12 characters")
      .max(200),
  });

  const parsed = schema.safeParse({
    SEED_SUPER_ADMIN_NAME: process.env.SEED_SUPER_ADMIN_NAME,
    SEED_SUPER_ADMIN_EMAIL: process.env.SEED_SUPER_ADMIN_EMAIL,
    SEED_SUPER_ADMIN_PASSWORD: process.env.SEED_SUPER_ADMIN_PASSWORD,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid seed configuration:\n${details}\n` +
        `Set SEED_SUPER_ADMIN_NAME / SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD in .env.local.`,
    );
  }

  return parsed.data;
}
