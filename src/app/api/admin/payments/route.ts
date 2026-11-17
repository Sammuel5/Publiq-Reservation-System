import { PERMISSIONS } from "@/config/app";
import { adminRoute, readQuery } from "@/lib/api/admin";
import { listPayments } from "@/lib/services/admin/payments";

/**
 * The payments ledger: every receipt in a date window, with per-method totals for
 * the night's cash sheet.
 */
export const GET = adminRoute({
  permission: PERMISSIONS.PAYMENT_VIEW,
  rate: { bucket: "admin:payments:list", limit: 240, windowMs: 5 * 60_000 },
  run: async ({ request }) => listPayments(readQuery(request)),
});

