/** Weekday helpers shared by the site footer, room pages and settings forms. */

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_LABELS_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * "Daily" when every day is selected, "Mon–Sun" for contiguous ranges,
 * otherwise a comma list ("Mon, Wed, Fri").
 */
export function formatOperatingDays(days: number[], labels: readonly string[] = DAY_LABELS): string {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length === 7) return "Daily";
  if (unique.length === 0) return "Closed";
  return unique.map((day) => labels[day] ?? String(day)).join(", ");
}

/** True when the club trades past midnight (closing earlier than opening). */
export function isOvernight(openingTime: string, closingTime: string): boolean {
  return closingTime <= openingTime;
}
