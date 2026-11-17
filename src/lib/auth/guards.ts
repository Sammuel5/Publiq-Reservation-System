import { cache } from "react";
import { redirect } from "next/navigation";
import { PERMISSIONS, roleHasPermission, type Permission } from "@/config/app";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { readSessionCookie } from "@/lib/auth/cookies";
import { validateSession, type ValidatedSession } from "@/lib/auth/session";

/**
 * Server-side authorization guards.
 *
 * These are the only place the app decides "is this admin allowed?".
 * Route handlers must call `requireApiAdmin`; server components/layouts call
 * `requireAdmin`. Client-side checks are cosmetic only.
 */

/**
 * Resolve the current admin from the session cookie, validated against the DB.
 * Cached per request so a page that renders several server components performs
 * a single session lookup.
 */
export const getCurrentAdmin = cache(
  async (): Promise<ValidatedSession | null> => {
    try {
      const token = await readSessionCookie();
      if (!token) return null;
      return await validateSession(token);
    } catch (error) {
      // Fail closed: an unreadable session means "not signed in".
      logger.error("auth.guard", "Session validation failed", error);
      return null;
    }
  },
);

/** For server components: redirect to login when unauthenticated. */
export async function requireAdmin(
  options: { nextPath?: string } = {},
): Promise<ValidatedSession> {
  const session = await getCurrentAdmin();
  if (!session) {
    const next = options.nextPath ? `?next=${encodeURIComponent(options.nextPath)}` : "";
    redirect(`/admin/login${next}`);
  }
  return session;
}

/** For server components: require a specific capability (redirects to 403 page). */
export async function requireAdminPermission(
  permission: Permission,
): Promise<ValidatedSession> {
  const session = await requireAdmin();
  if (!roleHasPermission(session.user.role, permission)) {
    redirect(`/admin/forbidden?permission=${encodeURIComponent(permission)}`);
  }
  return session;
}

/** For route handlers: throw typed 401/403 instead of redirecting. */
export async function requireApiAdmin(
  permission?: Permission,
): Promise<ValidatedSession> {
  const session = await getCurrentAdmin();
  if (!session) throw new UnauthorizedError();
  if (permission && !roleHasPermission(session.user.role, permission)) {
    throw new ForbiddenError(
      "Your role does not include permission for this action.",
    );
  }
  return session;
}

export function can(session: ValidatedSession | null, permission: Permission): boolean {
  if (!session) return false;
  return roleHasPermission(session.user.role, permission);
}

export { PERMISSIONS };
export type { Permission };
