import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody, readId } from "@/lib/api/admin";
import { ValidationError } from "@/lib/errors";
import { closeBlock, reopenBlock } from "@/lib/services/admin/blocks";

/**
 * Close or reopen a block. Blocks are soft-deleted so the record of a closure survives.
 */
export const POST = adminRoute({
  permission: PERMISSIONS.RESERVATION_EDIT,
  mutating: true,
  rate: { bucket: "admin:blocks:update", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    const body = (await readBody(request)) as { action?: string };
    // Explicit, because the fall-through would close the window for any typo.
    switch (body.action) {
      case "close":
        return closeBlock(id, actor);
      case "reopen":
        return reopenBlock(id, actor);
      default:
        throw new ValidationError("Say whether this window should close or reopen.");
    }
  },
});
