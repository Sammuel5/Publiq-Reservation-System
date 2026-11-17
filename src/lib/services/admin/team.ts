import { AdminSession, AdminUser } from "@/lib/db/models";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { hashPassword } from "@/lib/auth/password";
import { validatePasswordPolicy } from "@/lib/auth/password";
import { revokeAllSessionsForUser, revokeSessionById } from "@/lib/auth/session";
import { ADMIN_ROLE_LABELS, type AdminRole } from "@/config/app";
import { adminUserCreateSchema, adminUserUpdateSchema } from "@/lib/validation/admin";
import { formatClubDateTime } from "@/lib/utils/datetime";
import { getClubSettings } from "@/lib/services/club-settings";
import { normalizeEmail, normalizePersonName, sanitizeText } from "@/lib/utils/normalize";
import { isDuplicateKeyError } from "@/lib/errors";
import type { Actor } from "@/lib/services/admin/shared";

/**
 * Staff accounts (Super Admin only).
 *
 * Rules that protect the club from locking itself out:
 * - the **last active Super Admin cannot be demoted or deactivated**, so there is
 *   always somebody who can create an account;
 * - you **cannot deactivate yourself** (that would drop your own session
 *   mid-shift, which reads as a bug and is a bad way to go home);
 * - deactivating an account or resetting its password **revokes its sessions
 *   immediately** — the console never waits for a cookie to expire;
 * - passwords are checked against the same policy as the seed script and are
 *   never returned by any query (`select: false` on the hash).
 */

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  roleLabel: string;
  isActive: boolean;
  lastLoginAt: string | null;
  lastLoginLabel: string | null;
  openSessions: number;
  lockedUntil: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
  isSelf: boolean;
};

export async function listAdminUsers(actor: Actor): Promise<{ users: AdminUserRow[]; roleLabels: Record<AdminRole, string> }> {
  const [docs, sessions, settings] = await Promise.all([
    AdminUser.find({}).sort({ role: 1, name: 1 }).lean(),
    AdminSession.aggregate<{ _id: string; count: number }>([
      { $match: { revokedAt: null, expiresAt: { $gt: new Date() } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ]),
    getClubSettings(),
  ]);

  const openBy = new Map(sessions.map((row) => [String(row._id), row.count]));

  return {
    roleLabels: ADMIN_ROLE_LABELS,
    users: docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      email: doc.email,
      role: doc.role as AdminRole,
      roleLabel: ADMIN_ROLE_LABELS[doc.role as AdminRole] ?? doc.role,
      isActive: doc.isActive,
      lastLoginAt: doc.lastLoginAt ? new Date(doc.lastLoginAt).toISOString() : null,
      lastLoginLabel: doc.lastLoginAt
        ? formatClubDateTime(new Date(doc.lastLoginAt), settings.timezone)
        : null,
      openSessions: openBy.get(String(doc._id)) ?? 0,
      lockedUntil: doc.lockedUntil ? new Date(doc.lockedUntil).toISOString() : null,
      passwordChangedAt: doc.passwordChangedAt ? new Date(doc.passwordChangedAt).toISOString() : null,
      createdAt: new Date(doc.createdAt).toISOString(),
      isSelf: String(doc._id) === actor.id,
    })),
  };
}

function issueFields(issues: Array<{ path: (string | number)[]; message: string }>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_form";
    if (fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}

export async function createAdminUser(
  raw: unknown,
  actor: Actor,
): Promise<{ id: string; email: string; role: AdminRole }> {
  const parsed = adminUserCreateSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  if (!parsed.success) {
    throw new ValidationError("Some fields need your attention.", { fields: issueFields(parsed.error.issues) });
  }

  const policy = validatePasswordPolicy(parsed.data.password);
  if (!policy.ok) {
    throw new ValidationError("That password is not strong enough.", {
      fields: { password: policy.issues.join(" ") },
    });
  }

  const email = normalizeEmail(parsed.data.email);
  if (!email) {
    throw new ValidationError("Enter a valid email address.", { fields: { email: "Invalid address." } });
  }

  try {
    const doc = await AdminUser.create({
      name: normalizePersonName(parsed.data.name),
      email,
      passwordHash: await hashPassword(parsed.data.password),
      role: parsed.data.role,
      isActive: true,
      passwordChangedAt: new Date(),
    });
    logger.warn("admin.team.create", "Staff account created", { email, role: parsed.data.role, by: actor.email });
    return { id: String(doc._id), email, role: parsed.data.role as AdminRole };
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError("That email already has an account here.", {
        fields: { email: "Already registered." },
      });
    }
    throw error;
  }
}

export async function updateAdminUser(
  id: string,
  raw: unknown,
  actor: Actor,
): Promise<{ ok: true; changed: string[]; sessionsRevoked: number }> {
  const parsed = adminUserUpdateSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  if (!parsed.success) {
    throw new ValidationError("Some fields need your attention.", { fields: issueFields(parsed.error.issues) });
  }

  const target = await AdminUser.findById(id).lean();
  if (!target) throw new NotFoundError("That account no longer exists.");

  const { name, role, isActive, password } = parsed.data;
  const changed: string[] = [];
  const set: Record<string, unknown> = {};

  if (name !== undefined) {
    const next = normalizePersonName(name);
    if (next !== target.name) {
      set.name = next;
      changed.push("name");
    }
  }

  const demoting = role !== undefined && role !== "SUPER_ADMIN" && target.role === "SUPER_ADMIN";
  const deactivating = isActive === false && target.isActive;

  // Self-lockout is answered first: it is the more specific and more actionable
  // reason. Otherwise the only Super Admin disabling their own account is told
  // to create a second one — which is true, but not the point.
  if (deactivating && String(target._id) === actor.id) {
    throw new ValidationError("You cannot deactivate the account you are signed in with.");
  }
  if (demoting || deactivating) await assertNotLastSuperAdmin(target._id);

  if (role !== undefined && role !== target.role) {
    set.role = role;
    changed.push("role");
  }
  if (isActive !== undefined && isActive !== target.isActive) {
    set.isActive = isActive;
    changed.push(isActive ? "reactivated" : "deactivated");
    if (!isActive) set["lockedUntil"] = null;
  }
  if (name !== undefined && sanitizeText(name).length < 2) {
    throw new ValidationError("Enter a name for this account.", { fields: { name: "Too short." } });
  }

  let sessionsRevoked = 0;
  if (password !== undefined) {
    const policy = validatePasswordPolicy(password);
    if (!policy.ok) {
      throw new ValidationError("That password is not strong enough.", {
        fields: { password: policy.issues.join(" ") },
      });
    }
    set.passwordHash = await hashPassword(password);
    set.passwordChangedAt = new Date();
    set.failedLoginAttempts = 0;
    set.lockedUntil = null;
    changed.push("password");
    // The account holder must sign in again with the new password.
    sessionsRevoked = await revokeAllSessionsForUser(String(id));
  } else if (isActive === false) {
    sessionsRevoked = await revokeAllSessionsForUser(String(id));
  }

  if (changed.length > 0) await AdminUser.updateOne({ _id: id }, { $set: set });

  if (changed.length > 0) {
    logger.warn("admin.team.update", "Staff account updated", {
      account: target.email,
      changed,
      by: actor.email,
      sessionsRevoked,
    });
  }

  return { ok: true, changed, sessionsRevoked };
}

export async function unlockAdminUser(id: string, actor: Actor): Promise<{ ok: true }> {
  const updated = await AdminUser.findByIdAndUpdate(
    id,
    { $set: { failedLoginAttempts: 0, lockedUntil: null } },
    { new: true },
  ).lean();
  if (!updated) throw new NotFoundError("That account no longer exists.");
  logger.warn("admin.team.unlock", "Login lockout cleared", { account: updated.email, by: actor.email });
  return { ok: true };
}

export async function listSessionsForUser(id: string) {
  const sessions = await AdminSession.find({ user: id })
    .sort({ lastSeenAt: -1 })
    .limit(20)
    .select("lastSeenAt createdAt expiresAt revokedAt userAgent ipHint")
    .lean();

  return sessions.map((session) => ({
    id: String(session._id),
    createdAt: new Date(session.createdAt).toISOString(),
    lastSeenAt: new Date(session.lastSeenAt ?? session.createdAt).toISOString(),
    expiresAt: new Date(session.expiresAt).toISOString(),
    active: !session.revokedAt && new Date(session.expiresAt).getTime() > Date.now(),
    device: session.userAgent ? String(session.userAgent).slice(0, 120) : null,
    ip: session.ipHint ?? null,
  }));
}

export async function revokeSession(id: string, sessionId: string, actor: Actor): Promise<{ ok: true }> {
  await revokeSessionById(sessionId);
  logger.warn("admin.team.revoke", "Session revoked", { sessionId, by: actor.email, for: id });
  return { ok: true };
}

/** Refuses to leave the club with no way to manage staff. */
async function assertNotLastSuperAdmin(targetId: unknown): Promise<void> {
  const remaining = await AdminUser.countDocuments({
    role: "SUPER_ADMIN",
    isActive: true,
    _id: { $ne: targetId },
  });
  if (remaining === 0) {
    throw new ValidationError(
      "That is the last active Super Admin. Create another Super Admin account before changing this one — otherwise nobody can manage staff.",
    );
  }
}
