import { connectToDatabase } from "@/lib/db/mongoose";
import { AdminSession, AdminUser } from "@/lib/db/models";
import {
  equalizeVerifyTiming,
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from "@/lib/auth/password";
import {
  createSession,
  hashSessionToken,
  revokeAllSessionsForUser,
  revokeSessionByToken,
  type SafeAdminUser,
} from "@/lib/auth/session";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/cookies";
import { AccountLockedError, AppError, UnauthorizedError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { AdminRole } from "@/config/app";

/**
 * Admin authentication service.
 * Contains all credential logic so route handlers stay thin.
 */

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/** Single generic message: never reveal whether an email exists. */
const INVALID_CREDENTIALS = "Incorrect email or password.";

export type LoginMeta = {
  userAgent?: string | null;
  ipHint?: string | null;
};

export async function loginAdmin(
  email: string,
  password: string,
  meta: LoginMeta = {},
): Promise<{ user: SafeAdminUser; expiresAt: Date }> {
  await connectToDatabase();

  const user = await AdminUser.findOne({ email: email.toLowerCase().trim() }).select(
    "+passwordHash",
  );

  if (!user) {
    // Spend comparable time so response timing does not leak account existence.
    await equalizeVerifyTiming(password);
    logger.warn("auth.login", "Failed login: unknown email");
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const seconds = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
    const minutes = Math.ceil(seconds / 60);
    logger.warn("auth.login", "Login blocked: account temporarily locked", {
      userId: String(user._id),
    });
    throw new AccountLockedError(
      seconds,
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);

  if (!passwordOk) {
    // Use an atomic database update: parallel guesses must not overwrite each
    // other's failed-attempt counts or bypass the account lockout.
    const now = new Date();
    await AdminUser.collection.updateOne(
      { _id: user._id, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      [
        { $set: { failedLoginAttempts: { $add: [{ $ifNull: ["$failedLoginAttempts", 0] }, 1] } } },
        { $set: {
          lockedUntil: { $cond: [{ $gte: ["$failedLoginAttempts", MAX_FAILED_ATTEMPTS] }, new Date(now.getTime() + LOCKOUT_MINUTES * 60_000), null] },
          failedLoginAttempts: { $cond: [{ $gte: ["$failedLoginAttempts", MAX_FAILED_ATTEMPTS] }, 0, "$failedLoginAttempts"] },
        } },
      ],
    );
    logger.warn("auth.login", "Failed login: wrong password", {
      userId: String(user._id),
    });
    throw new UnauthorizedError(INVALID_CREDENTIALS);
  }

  if (user.isActive !== true) {
    throw new AppError(
      "This account has been deactivated. Contact a Super Admin.",
      { statusCode: 403, code: "ACCOUNT_INACTIVE" },
    );
  }

  // Re-check current credentials, active state and lockout atomically after the
  // password verification, in case another request changed them in the meantime.
  const approved = await AdminUser.updateOne(
    { _id: user._id, passwordHash: user.passwordHash, isActive: true,
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: new Date() } }] },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );
  if (approved.matchedCount !== 1) throw new UnauthorizedError(INVALID_CREDENTIALS);

  const { token, expiresAt } = await createSession(String(user._id), meta);
  await setSessionCookie(token, expiresAt);

  logger.info("auth.login", "Login succeeded", {
    userId: String(user._id),
    role: user.role,
  });

  return {
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role as AdminRole,
      isActive: user.isActive,
      lastLoginAt: new Date().toISOString(),
    },
    expiresAt,
  };
}

export async function logoutAdmin(token: string | undefined): Promise<void> {
  if (token) {
    await revokeSessionByToken(token);
  }
  await clearSessionCookie();
  logger.info("auth.logout", "Session revoked");
}

export type ChangePasswordResult = { otherSessionsRevoked: number };

/**
 * Change the signed-in admin's password.
 * All other sessions are revoked; the current session is preserved.
 */
export async function changeAdminPassword(params: {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordResult> {
  const { userId, currentSessionId, currentPassword, newPassword } = params;

  const policy = validatePasswordPolicy(newPassword);
  if (!policy.ok) throw new ValidationError(policy.issues[0] ?? "Weak password.", policy.issues);

  const user = await AdminUser.findById(userId).select("+passwordHash");
  if (!user) throw new UnauthorizedError();

  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Your current password is incorrect.");

  const passwordHash = await hashPassword(newPassword);
  user.passwordHash = passwordHash;
  user.passwordChangedAt = new Date();
  await user.save();

  const otherSessionsRevoked = await revokeAllSessionsForUser(userId, currentSessionId);

  logger.info("auth.password", "Password changed", { userId, otherSessionsRevoked });
  return { otherSessionsRevoked };
}

/** Admin-safe projection used by /api/auth/session. */
export async function listActiveSessions(userId: string) {
  const sessions = await AdminSession.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .select("createdAt lastSeenAt expiresAt ipHint userAgent")
    .sort({ lastSeenAt: -1 })
    .limit(20)
    .lean();

  return sessions.map((session) => ({
    id: String(session._id),
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    ipHint: session.ipHint,
    userAgent: session.userAgent,
  }));
}

export { hashSessionToken };
