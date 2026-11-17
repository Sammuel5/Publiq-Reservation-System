import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody } from "@/lib/api/admin";
import { createAdminUser, listAdminUsers } from "@/lib/services/admin/team";

/**
 * Staff accounts and their live sessions. Super Admin only.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.ADMIN_MANAGE,
  rate: { bucket: "admin:team:list", limit: 240, windowMs: 5 * 60_000 },
  run: async ({ actor }) => listAdminUsers(actor),
});

export const POST = adminRoute({
  permission: PERMISSIONS.ADMIN_MANAGE,
  mutating: true,
  rate: { bucket: "admin:team:create", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, actor }) => {
    const body = await readBody(request);
    return createAdminUser(body, actor);
  },
});
