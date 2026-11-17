import { ClubSettings } from "@/lib/db/models";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  DEFAULT_CLUB_SETTINGS,
  getClubSettings,
  type ClubSettingsView,
} from "@/lib/services/club-settings";
import { settingsDurationIssue, settingsSchema, type SettingsInput } from "@/lib/validation/admin";
import { blankToNull, sanitizeText } from "@/lib/utils/normalize";
import { durationBetweenHHMM } from "@/lib/utils/datetime";
import { isOvernight } from "@/lib/utils/opening-hours";
import type { Actor } from "@/lib/services/admin/shared";

/**
 * Club settings (Phase 3).
 *
 * This single document drives the customer site *and* the booking rules, so
 * every field here is a behaviour change, not just text. Two guards earn their
 * place:
 *
 * - The timezone is probed with `Intl.DateTimeFormat` before it is saved. A
 *   typo ("Asia/Mnaila") would otherwise silently move every slot boundary in
 *   the club by hours and corrupt future availability calculations.
 * - Opening hours are checked for the shapes the availability engine assumes:
 *   a non-empty window, and the overnight case is allowed (14:00 → 02:00)
 *   because that is what a late-night club actually is.
 *
 * Writes are upserts against `singleton: true`, so a fresh database picks the
 * documented defaults and the console can never end up with two settings rows.
 */

export type SettingsFormValue = ClubSettingsView;

export async function readSettings(): Promise<SettingsFormValue> {
  return getClubSettings();
}

function issueFields(issues: Array<{ path: (string | number)[]; message: string }>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_form";
    if (fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}

export function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new ValidationError("That timezone is not recognised.", {
      fields: { timezone: "Use an IANA name such as Asia/Manila." },
    });
  }
}

export type SettingsChange = { field: string; from: string; to: string };

function diffView(before: ClubSettingsView, data: SettingsInput): SettingsChange[] {
  const changes: SettingsChange[] = [];
  for (const key of Object.keys(data) as Array<keyof SettingsInput>) {
    // Socials are flattened into `socials.*` in the document and are diffed
    // explicitly below, so skip every spelling here.
    if (key === "facebook" || key === "instagram" || key === "tiktok" || key === "socials") continue;
    const previous = (before as unknown as Record<string, unknown>)[key];
    const next = (data as unknown as Record<string, unknown>)[key];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    changes.push({
      field: key,
      from: Array.isArray(previous) ? previous.join(",") : String(previous ?? "—"),
      to: Array.isArray(next) ? next.join(",") : String(next ?? "—"),
    });
  }
  return changes;
}

export async function updateSettings(
  raw: unknown,
  actor: Actor,
): Promise<{ ok: true; settings: ClubSettingsView; changes: SettingsChange[]; advisories: string[] }> {
  const before = await getClubSettings();
  const parsed = settingsSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  if (!parsed.success) {
    throw new ValidationError("Some fields need your attention.", {
      fields: issueFields(parsed.error.issues),
    });
  }

  const data = parsed.data;
  const fields = issueFields([]);
  const durationIssue = settingsDurationIssue(data);
  if (durationIssue) fields.defaultDuration = durationIssue;

  validateTimezone(data.timezone);

  const nightMinutes = durationBetweenHHMM(data.openingTime, data.closingTime);
  const windowMinutes = isOvernight(data.openingTime, data.closingTime)
    ? 1440 - toMinutes(data.openingTime) + toMinutes(data.closingTime)
    : nightMinutes;
  if (windowMinutes < 60) {
    fields.openingTime = "The club needs at least one hour of tradeable night.";
  }
  if (data.minimumDuration > windowMinutes) {
    fields.minimumDuration = "Bookings cannot be longer than the night itself.";
  }
  if (Object.keys(fields).length > 0) {
    throw new ValidationError("Some settings conflict with each other.", { fields });
  }

  // The form posts flat keys; a client posting back the reader's document sends
  // them nested. Flat wins, because that is what the visible fields hold.
  const socials = {
    facebook: blankToNull(data.facebook ?? data.socials?.facebook ?? ""),
    instagram: blankToNull(data.instagram ?? data.socials?.instagram ?? ""),
    tiktok: blankToNull(data.tiktok ?? data.socials?.tiktok ?? ""),
  };

  const set: Record<string, unknown> = {
    singleton: true,
    clubName: sanitizeText(data.clubName),
    tagline: blankToNull(data.tagline ?? ""),
    contactNumber: data.contactNumber,
    email: data.email.toLowerCase(),
    address: sanitizeText(data.address),
    mapUrl: data.mapUrl ?? null,
    logoUrl: data.logoUrl ?? null,
    operatingDays: data.operatingDays,
    openingTime: data.openingTime,
    closingTime: data.closingTime,
    defaultDuration: data.defaultDuration,
    minimumDuration: data.minimumDuration,
    pendingExpirationMinutes: data.pendingExpirationMinutes,
    cancellationPolicy: sanitizeText(data.cancellationPolicy),
    cancellationCutoffHours: data.cancellationCutoffHours,
    timezone: data.timezone,
    currency: data.currency,
    "socials.facebook": socials.facebook,
    "socials.instagram": socials.instagram,
    "socials.tiktok": socials.tiktok,
  };

  await ClubSettings.updateOne({ singleton: true }, { $set: set }, { upsert: true });

  const settings = await getClubSettings();
  const changes = diffView(before, data);
  for (const key of ["facebook", "instagram", "tiktok"] as const) {
    const previous = before.socials[key] ?? null;
    if (previous !== socials[key]) {
      changes.push({ field: key, from: previous ?? "—", to: socials[key] ?? "—" });
    }
  }
  const advisories: string[] = [];

  if (changes.some((change) => change.field === "timezone")) {
    advisories.push("Timezone changed — every future slot boundary on the website now follows the new zone.");
  }
  if (changes.some((change) => change.field === "openingTime" || change.field === "closingTime")) {
    advisories.push("Operating hours changed. Existing bookings outside the new window still stand; the site will stop offering them.");
  }
  if (changes.some((change) => change.field === "pendingExpirationMinutes")) {
    advisories.push(`Unconfirmed holds now expire after ${data.pendingExpirationMinutes} minutes.`);
  }
  if (changes.some((change) => change.field === "cancellationCutoffHours")) {
    advisories.push(
      data.cancellationCutoffHours === 0
        ? "Customers can now cancel any booking themselves, right up to start time."
        : `Self-cancellation closes ${data.cancellationCutoffHours} h before start; anything later becomes a request for you to approve.`,
    );
  }

  logger.info("admin.settings.update", "Club settings updated", {
    actor: actor.email,
    changes: changes.map((change) => change.field),
  });

  return { ok: true, settings, changes, advisories };
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Shown on the settings screen so defaults are visible next to overrides. */
export const SETTING_DEFAULTS = DEFAULT_CLUB_SETTINGS;
