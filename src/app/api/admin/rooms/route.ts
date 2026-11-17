import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody } from "@/lib/api/admin";
import { createRoom, listRooms } from "@/lib/services/admin/catalog";

/**
 * Rooms list + creation. Ordering, availability flags and maintenance status all come back in one call so the table needs no second round-trip.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.ROOM_VIEW,
  rate: { bucket: "admin:rooms:list", limit: 240, windowMs: 5 * 60_000 },
  run: async () => listRooms(),
});

export const POST = adminRoute({
  permission: PERMISSIONS.ROOM_MANAGE,
  mutating: true,
  rate: { bucket: "admin:rooms:create", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request }) => {
    const body = await readBody(request);
    return createRoom(body);
  },
});
