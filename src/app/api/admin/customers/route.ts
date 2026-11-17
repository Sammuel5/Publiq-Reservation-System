import { PERMISSIONS } from "@/config/app";
import { adminRoute, readQuery } from "@/lib/api/admin";
import { listCustomers } from "@/lib/services/admin/customers";

/**
 * Customer search. Every row carries booking counts and lifetime value, computed from the same reservations the board shows.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.CUSTOMER_VIEW,
  rate: { bucket: "admin:customers:list", limit: 240, windowMs: 5 * 60_000 },
  run: async ({ request }) => listCustomers(readQuery(request)),
});
