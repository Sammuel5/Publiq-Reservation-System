import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody, readId } from "@/lib/api/admin";
import { deleteCategory, updateCategory } from "@/lib/services/admin/catalog";

/**
 * Update or delete a category. A rename carries its rooms across to the new slug in the same operation.
 */
export const PATCH = adminRoute({
  permission: PERMISSIONS.ROOM_MANAGE,
  mutating: true,
  rate: { bucket: "admin:categories:update", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params }) => {
    const id = await readId(params);
    const body = await readBody(request);
    return updateCategory(id, body);
  },
});

export const DELETE = adminRoute({
  permission: PERMISSIONS.ROOM_MANAGE,
  mutating: true,
  rate: { bucket: "admin:categories:delete", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ params }) => {
    const id = await readId(params);
    return deleteCategory(id);
  },
});
