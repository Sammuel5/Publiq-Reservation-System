import { connectToDatabase } from "@/lib/db/mongoose";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { fieldErrorsFromZod } from "@/lib/validation/form-errors";
import type { ValidatedSession } from "@/lib/auth/session";
import type { ZodError } from "zod";

/**
 * Shared building blocks for the Phase 3 admin services.
 *
 * Every admin query goes through here so the console behaves consistently:
 * the same session→actor shape in every audit entry, the same escaping in every
 * search, the same 404/409/422 error vocabulary as the public API.
 */

/** Escape a user-supplied string so it can be used inside `$regex`. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive "contains" filter with the input escaped. */
export function containsRegex(value: string): { $regex: string; $options: string } {
  return { $regex: escapeRegex(value.trim()), $options: "i" };
}

/** Who is acting — stored on every status-history and note entry. */
export type Actor = { id: string; name: string; role: string; email: string };

export function actorFromSession(session: ValidatedSession): Actor {
  return {
    id: session.user.id,
    name: session.user.name,
    role: session.user.role,
    email: session.user.email,
  };
}

/** Normalize a ZodError into the `{ fields: { … } }` details shape. */
export function fieldErrors(error: ZodError): Record<string, string> {
  return fieldErrorsFromZod(error);
}

export function invalidFields(error: ZodError): never {
  throw new ValidationError("Some fields need your attention.", { fields: fieldErrors(error) });
}

export function notFound(message = "That record no longer exists."): never {
  throw new NotFoundError(message);
}

export function conflict(message: string, details?: unknown): never {
  throw new ConflictError(message, details);
}

export function requireFound<T>(value: T | null | undefined, message?: string): T {
  if (!value) notFound(message);
  return value as T;
}

/** Clamp pagination input; `page` is 1-based. */
export function pageSkip(page: number, perPage: number): number {
  return (Math.max(1, page) - 1) * perPage;
}

export type Paged<T> = {
  rows: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

export function paginate<T>(rows: T[], total: number, page: number, perPage: number): Paged<T> {
  return {
    rows,
    page,
    perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** Every admin service starts by making sure the pool is live. */
export async function ensureDb(): Promise<void> {
  await connectToDatabase();
}

/** Turn "2026-11-10" + "14:00" style inputs into a single sortable label. */
export function dateRange(from?: string, to?: string): { from: string; to: string } | null {
  if (!from && !to) return null;
  const fallbackFrom = from ?? to!;
  const fallbackTo = to ?? from!;
  return { from: fallbackFrom, to: fallbackTo };
}

export type SortDirection = "asc" | "desc";

export function sortSpec<K extends string>(field: K, dir: SortDirection): Record<K, 1 | -1> {
  return { [field]: dir === "desc" ? -1 : 1 } as Record<K, 1 | -1>;
}

/** Mongo `ObjectId`-safe conversion: invalid ids never reach the driver. */
export function isObjectIdLike(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);
}
