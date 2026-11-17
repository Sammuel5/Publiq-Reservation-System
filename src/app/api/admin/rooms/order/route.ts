import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody } from "@/lib/api/admin";
import { reorderRooms } from "@/lib/services/admin/catalog";

/**
 * Persist the room order after a drag or a move-up/move-down click. The whole ordered id list is sent so the result is deterministic even if two people reorder at once.
 */
export const PUT = adminRoute({
  permission: PERMISSIONS.ROOM_MANAGE,
  mutating: true,
  rate: { bucket: "admin:rooms:order", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request }) => {
    const body = await readBody(request);
    return reorderRooms(body);
  },
});
