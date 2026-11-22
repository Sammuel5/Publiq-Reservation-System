import { PERMISSIONS } from "@/config/app";
import { adminRoute, readId } from "@/lib/api/admin";
import { cancelSeatingBooking } from "@/lib/services/publiq-bookings/cancellation";

export const POST = adminRoute({
  permission: PERMISSIONS.SEATING_CANCEL,
  mutating: true,
  rate: { bucket: "admin:seating:cancel", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ params, actor }) => cancelSeatingBooking(await readId(params), actor.id),
});
