import { PERMISSIONS } from "@/config/app";
import { adminRoute, parse, readBody, readId } from "@/lib/api/admin";
import { decideCancellationRequest } from "@/lib/services/admin/reservations";
import { cancellationDecisionSchema } from "@/lib/validation/admin";

/**
 * Answer a customer's cancellation request. Declining keeps the booking and records the note; approving performs the cancellation and releases the room.
 */
export const POST = adminRoute({
  permission: PERMISSIONS.RESERVATION_DECIDE,
  mutating: true,
  rate: { bucket: "admin:reservations:decide", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const { decision, note } = parse(cancellationDecisionSchema, await readBody(request));
    return decideCancellationRequest(id, decision, note ?? null, actor);
  },
});
