import { PERMISSIONS } from "@/config/app";
import { adminRoute, readId } from "@/lib/api/admin";
import { deletePaymentEntry } from "@/lib/services/admin/payments";
import { ValidationError } from "@/lib/errors";

/**
 * Remove a payment entry.
 *
 * This is deliberately a *delete*, not an edit: correcting a receipt properly
 * means writing a REFUNDED row (see `POST /api/admin/payments/[id]` on the
 * reservation), and this endpoint exists for the rarer case where the entry
 * itself was a mistake — wrong booking, wrong amount, typed twice. The action is
 * logged with the account that performed it.
 */
export const DELETE = adminRoute({
  permission: PERMISSIONS.PAYMENT_MANAGE,
  mutating: true,
  rate: { bucket: "admin:payments:delete", limit: 30, windowMs: 5 * 60_000 },
  run: async ({ params, actor }) => {
    const id = await readId(params);
    if (!id) throw new ValidationError("Which entry should be removed?");
    return deletePaymentEntry(id, actor);
  },
});
