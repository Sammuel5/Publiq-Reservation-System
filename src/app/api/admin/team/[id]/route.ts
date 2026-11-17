import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody, readId } from "@/lib/api/admin";
import { ValidationError } from "@/lib/errors";
import {
  listSessionsForUser,
  revokeSession,
  unlockAdminUser,
  updateAdminUser,
} from "@/lib/services/admin/team";

/**
 * Change a staff account's role, status or password. Deactivating an account or resetting its password revokes its sessions immediately.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.ADMIN_MANAGE,
  rate: { bucket: "admin:team:sessions", limit: 240, windowMs: 5 * 60_000 },
  run: async ({ params }) => ({
    // readId, not the raw segment: `listSessionsForUser` would hand a
    // non-hex string straight to Mongoose and turn a typo into a 500.
    sessions: await listSessionsForUser(await readId(params)),
  }),
});

export const PATCH = adminRoute({
  permission: PERMISSIONS.ADMIN_MANAGE,
  mutating: true,
  rate: { bucket: "admin:team:update", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const body = await readBody(request);
    return updateAdminUser(id, body, actor);
  },
});

export const POST = adminRoute({
  permission: PERMISSIONS.ADMIN_MANAGE,
  mutating: true,
  rate: { bucket: "admin:team:action", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const body = (await readBody(request)) as { action?: string; sessionId?: string };
    // An explicit switch: falling through would mean an unrecognised action
    // silently performed "unlock" and reported success.
    switch (body.action) {
      case "unlock":
        return unlockAdminUser(id, actor);
      case "revoke-session":
        if (!body.sessionId) throw new ValidationError("Which session should be revoked?");
        return revokeSession(id, body.sessionId, actor);
      default:
        throw new ValidationError("That action is not available for this account.");
    }
  },
});
