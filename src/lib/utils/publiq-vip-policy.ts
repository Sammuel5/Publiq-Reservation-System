/** PUBLIQ VIP consumable minimum, in centavos. This is a minimum spend,
 * not a booking fee or deposit. The booking flow is not yet wired to it. */
export function vipConsumableMinimum(guestCount: number): number {
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 12) {
    throw new RangeError("VIP guest count must be a whole number from 1 to 12");
  }
  if (guestCount <= 5) return 0;
  if (guestCount <= 8) return 700_000;
  if (guestCount === 9) return 850_000;
  return 1_000_000;
}
