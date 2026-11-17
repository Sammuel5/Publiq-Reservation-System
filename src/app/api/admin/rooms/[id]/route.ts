import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody, readId } from "@/lib/api/admin";
import { deleteRoom, updateRoom } from "@/lib/services/admin/catalog";

/**
 * Update or retire a room. Deleting is refused while reservations reference it — the history is worth more than a tidy table.
 */
export const PATCH = adminRoute({
  permission: PERMISSIONS.ROOM_MANAGE,
  mutating: true,
  rate: { bucket: "admin:rooms:update", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params }) => {
    const id = await readId(params);
    const body = await readBody(request);
    return updateRoom(id, body);
  },
});

export const DELETE = adminRoute({
  permission: PERMISSIONS.ROOM_MANAGE,
  mutating: true,
  rate: { bucket: "admin:rooms:delete", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ params }) => {
    const id = await readId(params);
    return deleteRoom(id);
  },
});
