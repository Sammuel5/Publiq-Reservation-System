import { Reservation } from "@/lib/db/models";

/**
 * Shared aggregation helpers for the admin screens.
 *
 * `moneyForStatuses` exists because three different screens (dashboard, the
 * reservation board footer, the payments ledger) need the same "what is this
 * worth" number, and a subtly different definition in each place would be worse
 * than a little duplication.
 */
export async function moneyForStatuses(
  fromDate: string,
  toDate: string,
  statuses: string[],
): Promise<{ count: number; amount: number }> {
  const rows = await Reservation.aggregate<{ _id: null; count: number; amount: number }>([
    {
      $match: {
        reservationDate: { $gte: fromDate, $lte: toDate },
        status: { $in: statuses },
      },
    },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$estimatedAmount" } } },
  ]);
  const row = rows[0];
  return { count: row?.count ?? 0, amount: row?.amount ?? 0 };
}
