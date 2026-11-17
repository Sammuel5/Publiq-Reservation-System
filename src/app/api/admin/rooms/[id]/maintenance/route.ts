import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody, readId } from "@/lib/api/admin";
import { setRoomMaintenance } from "@/lib/services/admin/blocks";

/**
 * Maintenance status for one room, which the customer site reads through the availability engine.
 */
export const POST = adminRoute({
  permission: PERMISSIONS.ROOM_MANAGE,
  mutating: true,
  rate: { bucket: "admin:rooms:maintenance", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const body = await readBody(request);
    const status = String((body as { status?: string }).status ?? "OPERATIONAL");
    const note = (body as { note?: string }).note ?? null;
    if (status !== "OPERATIONAL" && status !== "SCHEDULED" && status !== "IN_PROGRESS") {
      throw new Error("Unknown maintenance status");
    }
    return setRoomMaintenance(id, status, note, actor);
  },
});
