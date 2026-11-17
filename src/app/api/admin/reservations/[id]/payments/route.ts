import { PERMISSIONS } from "@/config/app";
import { adminRoute, readBody, readId } from "@/lib/api/admin";
import { recordPayment } from "@/lib/services/admin/payments";

/**
 * Record a payment or refund against a booking. Amounts are checked against the live balance, so a typo cannot quietly over-collect.
 */
export const POST = adminRoute({
  permission: PERMISSIONS.PAYMENT_RECORD,
  mutating: true,
  rate: { bucket: "admin:payments:record", limit: 60, windowMs: 5 * 60_000 },
  run: async ({ request, params, actor }) => {
    const id = await readId(params);
    // `recordPayment` validates the payload itself. Parsing here as well would
    // validate its own output a second time — a "100.00" pesos string becomes
    // 10000 centavos after the first pass and fails the second.
    return recordPayment(id, await readBody(request), actor);
  },
});
