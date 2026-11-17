/** Reconciles MongoDB indexes with the Mongoose schemas (idempotent). */
import mongoose from "mongoose";
import { getServerEnv } from "../src/config/env";
import { Reservation, Room } from "../src/lib/db/models";

async function main() {
  const { MONGODB_URI, MONGODB_DB_NAME } = getServerEnv();
  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB_NAME, serverSelectionTimeoutMS: 15000 });
  console.log("→ Syncing indexes…");
  for (const [name, model] of [["reservations", Reservation], ["rooms", Room]] as const) {
    const dropped = await model.syncIndexes();
    console.log(`  ✓ ${name}${dropped.length ? ` (dropped ${dropped.join(", ")})` : ""}`);
  }
  await mongoose.connection.db!.collection("rate_limits").createIndex(
    { expiresAt: 1 }, { expireAfterSeconds: 0, name: "rate_limit_expiry" },
  );
  console.log("  ✓ rate_limits TTL");
  const indexes = await Reservation.collection.indexes();
  console.log("  reservations indexes:", indexes.map((index) => index.name).join(", "));
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error("✗ Index sync failed:", error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
