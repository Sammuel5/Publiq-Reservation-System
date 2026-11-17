import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody, readId } from "@/lib/api/admin";
import { getCustomerProfile, updateCustomer } from "@/lib/services/admin/customers";

/**
 * One guest's profile: their bookings, what they have paid, and how often they cancel.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.CUSTOMER_VIEW,
  rate: { bucket: "admin:customers:detail", limit: 240, windowMs: 5 * 60_000 },
  run: async ({ params }) => getCustomerProfile(await readId(params)),
});

export const PATCH = adminRoute({
  permission: PERMISSIONS.RESERVATION_EDIT,
  mutating: true,
  rate: { bucket: "admin:customers:update", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    // Validated once, in `updateCustomer` — the transform there maps a blank
    // email to null, and re-parsing that output would reject its own null.
    return updateCustomer(id, await readBody(request), actor);
  },
});
