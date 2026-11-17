import { createHash, randomBytes } from "node:crypto";
import type { AdminRole } from "@/config/app";
import { getServerEnv } from "@/config/env";
import { AdminSession, AdminUser } from "@/lib/db/models";
import { connectToDatabase } from "@/lib/db/mongoose";

/**
 * Server-side session management.
 *
 * 1. On login we generate a 256-bit random token.
 * 2. The browser receives it in an httpOnly, SameSite=Lax cookie (Secure in
 *    production) — JavaScript can never read it.
 * 3. The database stores only SHA-256(token), so a dump of `admin_sessions`
 *    cannot be used to impersonate anyone.
 * 4. Every request re-validates the session against the database, which makes
 *    logout, deactivation and password changes take effect immediately.
 */

export const SESSION_COOKIE_MAX_AGE_SECONDS_FALLBACK = 60 * 60 * 8;

export type SafeAdminUser = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
};

export type ValidatedSession = {
  sessionId: string;
  user: SafeAdminUser;
  expiresAt: Date;
};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function getSessionTtlMs(): number {
  const { AUTH_SESSION_TTL_HOURS } = getServerEnv();
  return AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000;
}

export type SessionMeta = {
  userAgent?: string | null;
  ipHint?: string | null;
};

export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + getSessionTtlMs());

  await AdminSession.create({
    user: userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
    lastSeenAt: new Date(),
    userAgent: meta.userAgent?.slice(0, 500) ?? null,
    ipHint: meta.ipHint ?? null,
  });

  return { token, expiresAt };
}

/**
 * Validate a cookie token. Returns null for unknown, revoked, expired sessions
 * or for sessions whose user has been deactivated/deleted.
 */
export async function validateSession(
  token: string | undefined | null,
): Promise<ValidatedSession | null> {
  if (!token || token.length < 20) return null;

  // A valid cookie can be the first request after a server restart or cold
  // start; establish the database connection before querying the session.
  await connectToDatabase();
  const session = await AdminSession.findOne({
    tokenHash: hashSessionToken(token),
    revokedAt: null,
  }).lean();

  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    await AdminSession.deleteOne({ _id: session._id });
    return null;
  }

  const user = await AdminUser.findById(session.user)
    .select("name email role isActive lastLoginAt")
    .lean<{
      _id: unknown;
      name: string;
      email: string;
      role: AdminRole;
      isActive: boolean;
      lastLoginAt?: Date | null;
    } | null>();

  if (!user || user.isActive !== true) return null;

  // Sliding "last seen" is best-effort; never block the request on it.
  void AdminSession.updateOne(
    { _id: session._id },
    { $set: { lastSeenAt: new Date() } },
  ).catch(() => undefined);

  return {
    sessionId: String(session._id),
    expiresAt: session.expiresAt,
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    },
  };
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await AdminSession.updateOne(
    { tokenHash: hashSessionToken(token), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  await AdminSession.updateOne(
    { _id: sessionId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/** Used after a password change or when an account is deactivated. */
export async function revokeAllSessionsForUser(
  userId: string,
  exceptSessionId?: string,
): Promise<number> {
  const filter: Record<string, unknown> = { user: userId, revokedAt: null };
  if (exceptSessionId) filter._id = { $ne: exceptSessionId };
  const result = await AdminSession.updateMany(filter, {
    $set: { revokedAt: new Date() },
  });
  return result.modifiedCount ?? 0;
}

/** Remove sessions that have already expired (defensive, TTL index is primary). */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await AdminSession.deleteMany({
    $or: [{ expiresAt: { $lte: new Date() } }, { revokedAt: { $ne: null } }],
  });
  return result.deletedCount ?? 0;
}

/** Truncate an IP for audit storage (never store the full address). */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0]?.trim();
  if (!first) return null;
  if (first.includes(":")) {
    const segments = first.split(":");
    return `${segments.slice(0, 3).join(":")}:…`;
  }
  const octets = first.split(".");
  if (octets.length === 4) return `${octets[0]}.${octets[1]}.${octets[2]}.x`;
  return first.slice(0, 32);
}
