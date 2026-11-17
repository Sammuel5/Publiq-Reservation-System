import { connectToDatabase, checkDatabaseHealth } from "@/lib/db/mongoose";
import {
  AdminSession,
  AdminUser,
  ClubSettings,
  Customer,
  Payment,
  Reservation,
  Room,
  RoomBlock,
  RoomCategory,
  RoomSlotLock,
} from "@/lib/db/models";
import { logger } from "@/lib/logger";

/**
 * Read-only diagnostics for the Phase 1 verification panel.
 * Real database introspection — no hardcoded values.
 */

export type CollectionStatus = {
  model: string;
  collection: string;
  documents: number;
  indexes: string[];
};

export type SystemStatus = {
  database: {
    connected: boolean;
    latencyMs: number | null;
    database: string | null;
    host: string | null;
    error: string | null;
  };
  collections: CollectionStatus[];
  clubSettingsReady: boolean;
  adminUsers: number;
  activeAdmins: number;
  activeSessions: number;
  notifications: { pending: number; sending: number; failed: number; emailConfigured: boolean; smsConfigured: boolean; staffConfigured: boolean };
};

const MODELS = [
  AdminUser,
  AdminSession,
  Customer,
  RoomCategory,
  Room,
  RoomBlock,
  RoomSlotLock,
  Reservation,
  Payment,
  ClubSettings,
] as const;

export async function getSystemStatus(): Promise<SystemStatus> {
  const health = await checkDatabaseHealth();

  if (!health.connected) {
    return {
      database: {
        connected: false,
        latencyMs: health.latencyMs ?? null,
        database: null,
        host: null,
        error: health.error ?? "Database unavailable",
      },
      collections: [],
      clubSettingsReady: false,
      adminUsers: 0,
      activeAdmins: 0,
      activeSessions: 0,
      notifications: { pending: 0, sending: 0, failed: 0, emailConfigured: false, smsConfigured: false, staffConfigured: false },
    };
  }

  await connectToDatabase();

  const collections = await Promise.all(
    MODELS.map(async (model) => {
      try {
        const [documents, indexes] = await Promise.all([
          model.countDocuments(),
          model.collection.indexes().catch(() => []),
        ]);
        return {
          model: model.modelName,
          collection: model.collection.name,
          documents,
          indexes: indexes.map((index) => index.name ?? "(unnamed)"),
        };
      } catch (error) {
        logger.warn("system-status", `Failed to inspect ${model.modelName}`, error);
        return {
          model: model.modelName,
          collection: model.collection.name,
          documents: 0,
          indexes: [],
        };
      }
    }),
  );

  const [clubSettingsReady, adminUsers, activeAdmins, activeSessions] = await Promise.all([
    ClubSettings.exists({ singleton: true }).then(Boolean),
    AdminUser.countDocuments(),
    AdminUser.countDocuments({ isActive: true }),
    AdminSession.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }),
  ]);

  const counts = await Reservation.aggregate<{ _id: string; count: number }>([
    { $match: { "notifications.state": { $in: ["pending", "sending", "failed"] } } },
    { $unwind: "$notifications" },
    { $match: { "notifications.state": { $in: ["pending", "sending", "failed"] } } },
    { $group: { _id: "$notifications.state", count: { $sum: 1 } } },
  ]);
  const count = (state: string) => counts.find((entry) => entry._id === state)?.count ?? 0;
  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL);
  const smsConfigured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  return {
    notifications: { pending: count("pending"), sending: count("sending"), failed: count("failed"), emailConfigured, smsConfigured, staffConfigured: emailConfigured && Boolean(process.env.NOTIFICATION_STAFF_EMAIL) },
    database: {
      connected: true,
      latencyMs: health.latencyMs ?? null,
      database: health.database ?? null,
      host: health.host ?? null,
      error: null,
    },
    collections,
    clubSettingsReady,
    adminUsers,
    activeAdmins,
    activeSessions,
  };
}
