import { PERMISSIONS } from "@/config/app";
import { adminRoute, parse, readBody, readId } from "@/lib/api/admin";
import { addInternalNote } from "@/lib/services/admin/reservations";
import { internalNoteSchema } from "@/lib/validation/admin";

/**
 * Append an internal note. Notes are additive and never editable — an audit trail that can be rewritten is not one.
 */
export const POST = adminRoute({
  permission: PERMISSIONS.RESERVATION_EDIT,
  mutating: true,
  rate: { bucket: "admin:reservations:note", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const { body } = parse(internalNoteSchema, await readBody(request));
    return addInternalNote(id, body, actor);
  },
});
