import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody, readQuery } from "@/lib/api/admin";
import { createBlock, listBlocks } from "@/lib/services/admin/blocks";

/**
 * Blocked windows — per room or venue-wide. Creating one that overlaps live bookings is refused unless the admin explicitly acknowledges the clash.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.RESERVATION_EDIT,
  rate: { bucket: "admin:blocks:list", limit: 240, windowMs: 5 * 60_000 },
  run: async ({ request }) => listBlocks(readQuery(request)),
});

export const POST = adminRoute({
  permission: PERMISSIONS.RESERVATION_EDIT,
  mutating: true,
  rate: { bucket: "admin:blocks:create", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, actor }) => {
    const body = await readBody(request);
    return createBlock(body, actor);
  },
});
