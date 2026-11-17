import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";

/**
 * Typed application errors + a single JSON error envelope:
 *   { error: { code, message, details? } }
 * Client code can rely on this shape for every API route.
 */

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      details?: unknown;
      expose?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? "INTERNAL_ERROR";
    this.details = options.details;
    this.expose = options.expose ?? this.statusCode < 500;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Some fields need your attention.", details?: unknown) {
    super(message, { statusCode: 422, code: "VALIDATION_ERROR", details });
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "You need to sign in to continue.") {
    super(message, { statusCode: 401, code: "UNAUTHORIZED" });
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message, { statusCode: 403, code: "FORBIDDEN" });
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "We could not find what you were looking for.") {
    super(message, { statusCode: 404, code: "NOT_FOUND" });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "That action conflicts with the current state.", details?: unknown) {
    super(message, { statusCode: 409, code: "CONFLICT", details });
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Too many requests. Please try again shortly.") {
    super(message, { statusCode: 429, code: "RATE_LIMITED" });
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Login quotas may apply to the network or to the submitted email. */
export class LoginRateLimitError extends RateLimitError {
  constructor(retryAfterSeconds: number, readonly scope: "ip" | "email") {
    super(retryAfterSeconds);
    this.name = "LoginRateLimitError";
  }
}

/** A temporary account lock, with the precise delay supplied to the client. */
export class AccountLockedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message: string) {
    super(message, { statusCode: 423, code: "ACCOUNT_LOCKED" });
    this.name = "AccountLockedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class DatabaseError extends AppError {
  constructor(message = "The database is unavailable right now.", cause?: unknown) {
    super(message, { statusCode: 503, code: "DATABASE_UNAVAILABLE", cause });
    this.name = "DatabaseError";
  }
}

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

/** Convert any thrown value into a safe JSON HTTP response. */
export function toErrorResponse(error: unknown, context?: string): NextResponse<ApiErrorPayload> {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Some fields need your attention.",
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 422 },
    );
  }

  if (error instanceof RateLimitError || error instanceof AccountLockedError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.statusCode, headers: {
        "Retry-After": String(error.retryAfterSeconds),
        "Cache-Control": "no-store",
        ...(error instanceof LoginRateLimitError ? { "X-Login-Limit-Scope": error.scope } : {}),
        ...(error instanceof AccountLockedError ? { "X-Login-Limit-Scope": "account" } : {}),
      } },
    );
  }

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(context ?? "api", error.message, { code: error.code, cause: error.cause });
    }
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.expose ? error.message : "Something went wrong on our side.",
          ...(error.expose && error.details !== undefined
            ? { details: error.details }
            : {}),
        },
      },
      { status: error.statusCode },
    );
  }

  logger.error(context ?? "api", "Unhandled error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side." } },
    { status: 500 },
  );
}

/**
 * Map Mongo's duplicate-key error to a ConflictError with a friendly message.
 * Used to translate unique indexes (references, mobile numbers) into UX copy.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}
