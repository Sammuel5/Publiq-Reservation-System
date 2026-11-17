import { connectToDatabase } from "@/lib/db/mongoose";
import { ClubSettings } from "@/lib/db/models";
import { logger } from "@/lib/logger";

/**
 * Club settings access.
 *
 * A single settings document drives business rules and public site content.
 * If it does not exist yet (fresh database), it is created with documented
 * defaults so the customer site can always render.
 */

export type ClubSettingsView = {
  clubName: string;
  logoUrl: string | null;
  tagline: string | null;
  contactNumber: string;
  email: string;
  address: string;
  mapUrl: string | null;
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  defaultDuration: number;
  minimumDuration: number;
  pendingExpirationMinutes: number;
  cancellationPolicy: string;
  cancellationCutoffHours: number;
  timezone: string;
  currency: string;
  socials: {
    facebook: string | null;
    instagram: string | null;
    tiktok: string | null;
  };
};

export const DEFAULT_CLUB_SETTINGS: ClubSettingsView = {
  clubName: "PUBLIQ",
  logoUrl: null,
  tagline: "Booths, couches. Signature nights.",
  contactNumber: "+63 917 000 0000",
  email: "hello@publiq.example",
  address: "Antipolo City, Rizal, Philippines",
  mapUrl: null,
  operatingDays: [0, 1, 2, 3, 4, 5, 6],
  openingTime: "21:00",
  closingTime: "04:00",
  defaultDuration: 120,
  minimumDuration: 60,
  pendingExpirationMinutes: 120,
  cancellationPolicy:
    "Cancellation requests must be made at least 4 hours before the reserved start time. Requests inside that window are subject to management approval.",
  cancellationCutoffHours: 4,
  timezone: "Asia/Manila",
  currency: "PHP",
  socials: { facebook: null, instagram: null, tiktok: null },
};

export async function getClubSettings(): Promise<ClubSettingsView> {
  await connectToDatabase();

  const existing = await ClubSettings.findOne({ singleton: true }).lean();
  if (existing) return toView(existing);

  const created = await ClubSettings.findOneAndUpdate(
    { singleton: true },
    { $setOnInsert: { ...DEFAULT_CLUB_SETTINGS, singleton: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  if (!created) {
    logger.warn("club-settings", "Settings document missing; serving defaults");
    return DEFAULT_CLUB_SETTINGS;
  }
  return toView(created);
}

function toView(doc: Record<string, any>): ClubSettingsView {
  return {
    clubName: doc.clubName ?? DEFAULT_CLUB_SETTINGS.clubName,
    logoUrl: doc.logoUrl ?? null,
    tagline: doc.tagline ?? null,
    contactNumber: doc.contactNumber ?? DEFAULT_CLUB_SETTINGS.contactNumber,
    email: doc.email ?? DEFAULT_CLUB_SETTINGS.email,
    // The old bundled demo address was never PUBLIQ’s real location. Correct
    // that exact placeholder for existing installs without changing custom addresses.
    address: doc.address === "Level 3, The Grand Strip, Bacoor, Cavite, Philippines"
      ? DEFAULT_CLUB_SETTINGS.address
      : doc.address ?? DEFAULT_CLUB_SETTINGS.address,
    mapUrl: doc.mapUrl ?? null,
    operatingDays: doc.operatingDays ?? DEFAULT_CLUB_SETTINGS.operatingDays,
    openingTime: doc.openingTime ?? DEFAULT_CLUB_SETTINGS.openingTime,
    closingTime: doc.closingTime ?? DEFAULT_CLUB_SETTINGS.closingTime,
    defaultDuration: doc.defaultDuration ?? DEFAULT_CLUB_SETTINGS.defaultDuration,
    minimumDuration: doc.minimumDuration ?? DEFAULT_CLUB_SETTINGS.minimumDuration,
    pendingExpirationMinutes:
      doc.pendingExpirationMinutes ?? DEFAULT_CLUB_SETTINGS.pendingExpirationMinutes,
    cancellationPolicy:
      doc.cancellationPolicy ?? DEFAULT_CLUB_SETTINGS.cancellationPolicy,
    cancellationCutoffHours:
      doc.cancellationCutoffHours ?? DEFAULT_CLUB_SETTINGS.cancellationCutoffHours,
    timezone: doc.timezone ?? DEFAULT_CLUB_SETTINGS.timezone,
    currency: doc.currency ?? DEFAULT_CLUB_SETTINGS.currency,
    socials: {
      facebook: doc.socials?.facebook ?? null,
      instagram: doc.socials?.instagram ?? null,
      tiktok: doc.socials?.tiktok ?? null,
    },
  };
}
