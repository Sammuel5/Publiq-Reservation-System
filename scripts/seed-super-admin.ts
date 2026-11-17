/**
 * Bootstrap script — safe, idempotent provisioning of the first Super Admin
 * plus database indexes and the club settings document.
 *
 * Usage:
 *   npm run seed:admin            # create the Super Admin if missing
 *   npm run seed:admin -- --force # reset that account's password + role
 *
 * Credentials come ONLY from environment variables (see .env.example).
 * Nothing is hardcoded, and the password is never printed.
 */
import mongoose from "mongoose";
import { getSeedEnv, getServerEnv } from "../src/config/env";
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
} from "../src/lib/db/models";
import { hashPassword, validatePasswordPolicy } from "../src/lib/auth/password";
import { DEFAULT_CLUB_SETTINGS } from "../src/lib/services/club-settings";

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

async function main() {
  const force = process.argv.includes("--force");
  const { MONGODB_URI, MONGODB_DB_NAME } = getServerEnv();
  const seed = getSeedEnv();

  const policy = validatePasswordPolicy(seed.SEED_SUPER_ADMIN_PASSWORD);
  if (!policy.ok) {
    console.error("✗ Seed password does not satisfy the password policy:");
    for (const issue of policy.issues) console.error(`   - ${issue}`);
    process.exit(1);
  }

  console.log("→ Connecting to MongoDB…");
  await mongoose.connect(MONGODB_URI, {
    dbName: MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 15_000,
  });
  console.log(`✓ Connected (db: ${mongoose.connection.name})`);

  // 1) Indexes — unique constraints are what make double-booking preventions
  //    and reference uniqueness reliable, so create them explicitly.
  console.log("→ Ensuring indexes…");
  for (const model of MODELS) {
    try {
      await model.syncIndexes();
      console.log(`  ✓ ${model.collection.name}`);
    } catch (error) {
      console.error(`  ✗ ${model.collection.name}:`, (error as Error).message);
      throw error;
    }
  }

  // 2) Club settings singleton
  const settings = await ClubSettings.findOneAndUpdate(
    { singleton: true },
    { $setOnInsert: { ...DEFAULT_CLUB_SETTINGS, singleton: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  console.log(`✓ Club settings ready (${settings?.clubName})`);

  // 3) Super Admin
  const email = seed.SEED_SUPER_ADMIN_EMAIL.toLowerCase().trim();
  const existing = await AdminUser.findOne({ email }).select("+passwordHash");

  if (existing && !force) {
    console.log(`✓ Super Admin already exists: ${email} (use --force to reset)`);
  } else {
    const passwordHash = await hashPassword(seed.SEED_SUPER_ADMIN_PASSWORD);

    if (existing) {
      existing.passwordHash = passwordHash;
      existing.name = seed.SEED_SUPER_ADMIN_NAME;
      existing.role = "SUPER_ADMIN";
      existing.isActive = true;
      existing.failedLoginAttempts = 0;
      existing.lockedUntil = null;
      existing.passwordChangedAt = new Date();
      await existing.save();

      const revoked = await AdminSession.updateMany(
        { user: existing._id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      );
      console.log(
        `✓ Super Admin password reset: ${email} (${revoked.modifiedCount} session(s) revoked)`,
      );
    } else {
      const created = await AdminUser.create({
        name: seed.SEED_SUPER_ADMIN_NAME,
        email,
        passwordHash,
        role: "SUPER_ADMIN",
        isActive: true,
        passwordChangedAt: new Date(),
      });
      console.log(`✓ Super Admin created: ${created.email} [${created.role}]`);
    }
  }

  const counts = {
    admins: await AdminUser.countDocuments(),
    settings: await ClubSettings.countDocuments(),
    rooms: await Room.countDocuments(),
    reservations: await Reservation.countDocuments(),
  };
  console.log("✓ Summary:", counts);
  console.log("Done.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("✗ Seed failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
