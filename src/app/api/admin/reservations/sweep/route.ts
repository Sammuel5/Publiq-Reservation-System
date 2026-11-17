import { PERMISSIONS } from "@/config/app";
import { adminRoute } from "@/lib/api/admin";
import { sweepExpiredPending } from "@/lib/services/admin/reservations";

/**
 * Release expired pending holds on demand. The board also calls this opportunistically, but a manual run keeps the sweep testable (and useful before a big night).
 */
export const POST = adminRoute({
  permission: PERMISSIONS.RESERVATION_STATUS,
  mutating: true,
  rate: { bucket: "admin:reservations:sweep", limit: 60, windowMs: 5 * 60_000 },
  run: async () => sweepExpiredPending(),
});
