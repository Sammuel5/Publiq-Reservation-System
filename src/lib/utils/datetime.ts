/**
 * Timezone-safe date/time helpers for club-local business time.
 *
 * Everything the staff and customers see (operating hours, reservation dates,
 * start times) is expressed in the club timezone configured in ClubSettings.
 * Everything the database compares (overlaps, expiry) is a UTC instant.
 *
 * These helpers use the built-in `Intl` API only — no date library — so they run
 * identically on the server, in the browser and on Vercel's edge runtime.
 */

export const DEFAULT_TIMEZONE = "Asia/Manila";

/** "YYYY-MM-DD" + "HH:mm" pair in club-local time. */
export type ClubDateTimeStrings = {
  date: string;
  time: string;
};

function partsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });

  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const hour = Number(get("hour"));

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

/** Offset (ms) of the given timezone at the given instant: local − UTC. */
export function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInTimeZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/** Current instant expressed as club-local date/time strings. */
export function getClubNow(date: Date, timeZone: string): ClubDateTimeStrings {
  const p = partsInTimeZone(date, timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

export function toClubDateString(date: Date, timeZone: string): string {
  return getClubNow(date, timeZone).date;
}

export function toClubTimeString(date: Date, timeZone: string): string {
  return getClubNow(date, timeZone).time;
}

/** 0 = Sunday … 6 = Saturday, in club-local time. */
export function getClubWeekday(date: Date, timeZone: string): number {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const weekday = partsInTimeZone(date, timeZone).weekday;
  return names.indexOf(weekday as (typeof names)[number]);
}

/**
 * Convert a club-local date + time into a UTC instant.
 * Two-pass conversion handles DST transitions correctly (no DST in Asia/Manila,
 * but the helper stays correct for any configured club timezone).
 */
export function clubDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = timeStr.split(":").map(Number);

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error(`Invalid club date/time: ${dateStr} ${timeStr}`);
  }

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstPass = naiveUtc - getTimeZoneOffsetMs(new Date(naiveUtc), timeZone);
  const secondPass = naiveUtc - getTimeZoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(secondPass);
}

export function minutesToHHMM(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

export function hhmmToMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  if (hour === undefined || minute === undefined || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid HH:mm value: ${hhmm}`);
  }
  return hour * 60 + minute;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(year!, month! - 1, day!));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

/** Minutes between two HH:mm values, handling windows that cross midnight. */
export function durationBetweenHHMM(start: string, end: string): number {
  const startMinutes = hhmmToMinutes(start);
  let endMinutes = hhmmToMinutes(end);
  if (endMinutes <= startMinutes) endMinutes += 1440;
  return endMinutes - startMinutes;
}

/** Human-friendly club-local rendering, e.g. "Fri, Nov 14, 2026 · 8:00 PM". */
export function formatClubDateTime(
  date: Date,
  timeZone: string,
  options: { withTime?: boolean; withWeekday?: boolean } = {},
): string {
  const { withTime = true, withWeekday = true } = options;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone,
    weekday: withWeekday ? "short" : undefined,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: withTime ? "numeric" : undefined,
    minute: withTime ? "2-digit" : undefined,
    hour12: true,
  }).format(date);
}

/** "8:00 PM" from "20:00". */
export function formatClubTime12h(hhmm: string): string {
  const [hour, minute] = hhmm.split(":").map(Number);
  const date = new Date(Date.UTC(2000, 0, 1, hour!, minute!));
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** "Friday, November 14, 2026" from "2026-11-14". */
export function formatClubDateLong(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
