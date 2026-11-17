import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { ZodTypeAny } from "zod";
import type { Permission } from "@/config/app";
import { requireApiAdmin } from "@/lib/auth/guards";
import type { ValidatedSession } from "@/lib/auth/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isSameOriginRequest, rateLimitSubject, readJsonBody } from "@/lib/http";
import { ForbiddenError, NotFoundError, ValidationError, toErrorResponse } from "@/lib/errors";
import { filterParams, objectIdField } from "@/lib/validation/admin";
import { actorFromSession, type Actor } from "@/lib/services/admin/shared";

/**
 * One envelope for every `/api/admin/*` route.
 *
 * Centralising this matters because the admin surface is exactly where a missed
 * check hurts: a forgotten permission test would let a barista approve
 * cancellations, and a forgotten same-origin check would make every mutation
 * CSRF-able. Here, a route states *what it needs* and cannot quietly omit it.
 *
 * Order of operations, always:
 *   1. origin check (for anything that writes)
 *   2. rate limit (per masked IP)
 *   3. session + role permission  ← the only authorization decision
 *   4. the handler, which validates its own input with a Zod schema
 *   5. error → the shared JSON envelope (no stack traces, no Mongo messages)
 */

export type AdminContext = {
  request: NextRequest;
  session: ValidatedSession;
  actor: Actor;
  /**
   * Dynamic route segments. Every dynamic `/api/admin/*` route is keyed by a
   * single `id`, so the shape is fixed here — and `readId` below is the only way
   * handlers should touch it, which keeps a malformed id out of Mongoose.
   */
  params: Promise<{ id: string }>;
};

type RouteOptions = {
  permission?: Permission;
  mutating?: boolean;
  rate?: { bucket: string; limit: number; windowMs: number };
  run: (context: AdminContext) => Promise<unknown>;
};

export function adminRoute(options: RouteOptions) {
  const scope = `admin:${options.rate?.bucket ?? "route"}`;

  // The context argument is typed exactly the way Next.js declares it for route
  // handlers — the build validates that declared type and rejects anything
  // optional, defaulted or narrowed. Static routes are unaffected because a
  // function that ignores its second argument is still a valid handler.
  return async function handler(
    request: NextRequest,
    routeContext: { params: Promise<Record<string, string | string[]>> },
  ): Promise<NextResponse> {
    try {
      if (options.mutating && !isSameOriginRequest(request)) {
        throw new ForbiddenError("That request did not come from the club console.");
      }

      if (options.rate) {
        await enforceRateLimit({
          key: `${options.rate.bucket}:${rateLimitSubject(request.headers)}`,
          limit: options.rate.limit,
          windowMs: options.rate.windowMs,
        });
      }

      const session = await requireApiAdmin(options.permission);
      const result = await options.run({
        request,
        session,
        actor: actorFromSession(session),
        params: routeContext.params as unknown as Promise<{ id: string }>,
      });

      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return toErrorResponse(error, scope);
    }
  };
}

/**
 * Await and validate the `:id` segment. A stale bookmark or a hand-typed URL
 * becomes a clean 404 instead of a CastError from inside Mongoose.
 */
export async function readId(params: Promise<{ id: string }>): Promise<string> {
  const result = objectIdField.safeParse((await params).id);
  if (!result.success) throw new NotFoundError("That record does not exist.");
  return result.data;
}

/** Body for writes: must be JSON, must be an object. */
export async function readBody(request: NextRequest): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await readJsonBody(request);
  } catch {
    throw new ValidationError("Send a JSON body with Content-Type: application/json.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("Send a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** Query string for reads: repeated keys become arrays (status filters). */
export function readQuery(request: NextRequest): Record<string, unknown> {
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const all = request.nextUrl.searchParams.getAll(key);
    params[key] = all.length > 1 ? all : (all[0] ?? "");
  }
  return filterParams(params);
}

/** Validate and return `data`, converting schema failures into 422 + field map. */
export function parse<S extends ZodTypeAny>(schema: S, raw: unknown): S["_output"] {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_form";
      if (fields[key] === undefined) fields[key] = issue.message;
    }
    throw new ValidationError("Some fields need your attention.", { fields });
  }
  return result.data as S["_output"];
}

export type { Permission };
