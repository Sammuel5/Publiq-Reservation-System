/**
 * Money handling.
 *
 * All monetary values in this application are stored as INTEGER CENTAVOS
 * (₱1,500.00 === 150000). Never store or compute currency in floating point.
 */

export const DEFAULT_CURRENCY = "PHP";

export function formatMoney(
  centavos: number,
  options: { currency?: string; withSymbol?: boolean } = {},
): string {
  const { currency = DEFAULT_CURRENCY, withSymbol = true } = options;
  const amount = centavos / 100;
  const formatted = new Intl.NumberFormat("en-PH", {
    style: withSymbol ? "currency" : "decimal",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    currencyDisplay: "narrowSymbol",
  }).format(amount);
  return formatted;
}

/** Parse user-entered pesos ("1,500.50") into integer centavos, or null. */
export function parsePesosToCentavos(raw: string): number | null {
  const cleaned = raw.replace(/[,\s₱]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function centavosToPesosInput(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

/**
 * Price for a booking: hourly rate prorated by minutes, rounded to the nearest
 * centavo. Always call this on the server — the client only displays the result.
 */
export function calculateReservationAmount(
  hourlyRateCentavos: number,
  durationMinutes: number,
): number {
  if (hourlyRateCentavos < 0 || durationMinutes <= 0) return 0;
  return Math.round((hourlyRateCentavos * durationMinutes) / 60);
}
