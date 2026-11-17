import { PERMISSIONS } from "@/config/app";
import { adminRoute, parse, readBody, readId } from "@/lib/api/admin";
import {
  getReservationDetail,
  updateReservationDetails,
} from "@/lib/services/admin/reservations";
import { reservationEditSchema } from "@/lib/validation/admin";

/**
 * One reservation, fully expanded: timeline, notes, payments, balances and the actions this admin is allowed to take.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.RESERVATION_VIEW,
  rate: { bucket: "admin:reservations:detail", limit: 240, windowMs: 5 * 60_000 },
  run: async ({ params, actor }) => getReservationDetail(await readId(params), actor),
});

export const PATCH = adminRoute({
  permission: PERMISSIONS.RESERVATION_EDIT,
  mutating: true,
  rate: { bucket: "admin:reservations:edit", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const input = parse(reservationEditSchema, await readBody(request));
    return updateReservationDetails(id, input, actor);
  },
});
