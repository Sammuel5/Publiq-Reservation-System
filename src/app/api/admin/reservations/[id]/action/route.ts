import { PERMISSIONS } from "@/config/app";
import { adminRoute, parse, readBody, readId } from "@/lib/api/admin";
import { applyReservationAction } from "@/lib/services/admin/reservations";
import { reservationActionSchema } from "@/lib/validation/admin";

/**
 * Status transitions. Every action goes through the same guarded transition table the pages use, so a click and an API call can never diverge.
 */
export const POST = adminRoute({
  permission: PERMISSIONS.RESERVATION_VIEW,
  mutating: true,
  rate: { bucket: "admin:reservations:action", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const input = parse(reservationActionSchema, await readBody(request));
    return applyReservationAction(id, input, actor);
  },
});
