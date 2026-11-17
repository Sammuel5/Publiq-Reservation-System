import { PERMISSIONS } from "@/config/app";
import { adminRoute, parse, readBody, readId } from "@/lib/api/admin";
import { moveReservation } from "@/lib/services/admin/reservations";
import { reservationMoveSchema } from "@/lib/validation/admin";

/**
 * Move or re-room a live booking. Availability, capacity and price are all recomputed server-side; the slot locks are swapped atomically and rolled back if the new window is taken.
 */
export const POST = adminRoute({
  permission: PERMISSIONS.RESERVATION_EDIT,
  mutating: true,
  rate: { bucket: "admin:reservations:move", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const input = parse(reservationMoveSchema, await readBody(request));
    return moveReservation(id, input, actor);
  },
});
