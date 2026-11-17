import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody } from "@/lib/api/admin";
import { createCategory, listCategories } from "@/lib/services/admin/catalog";

/**
 * Room categories (Standard / VIP / …). The public site groups by these, so the console owns their names, order and slugs.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.ROOM_VIEW,
  rate: { bucket: "admin:categories:list", limit: 240, windowMs: 5 * 60_000 },
  run: async () => ({ categories: await listCategories() }),
});

export const POST = adminRoute({
  permission: PERMISSIONS.ROOM_MANAGE,
  mutating: true,
  rate: { bucket: "admin:categories:create", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request }) => {
    const body = await readBody(request);
    return createCategory(body);
  },
});
