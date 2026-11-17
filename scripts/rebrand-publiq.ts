/** One-time, narrowly scoped update for databases made from the old demo seed.
 * Does not replace custom names, settings, bookings, rates or account data. */
import mongoose from "mongoose";
import { getServerEnv } from "../src/config/env";

async function main() {
  const { MONGODB_URI, MONGODB_DB_NAME } = getServerEnv();
  await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB_NAME, serverSelectionTimeoutMS: 15_000 });
  try {
    const db = mongoose.connection.db!;
    const club = await db.collection("club_settings").updateOne(
      { singleton: true, clubName: "Nocturne KTV Lounge" }, { $set: { clubName: "PUBLIQ" } },
    );
    const email = await db.collection("club_settings").updateOne(
      { singleton: true, email: "hello@nocturne-ktv.example" }, { $set: { email: "hello@publiq.example" } },
    );
    const room = await db.collection("rooms").updateOne(
      { slug: "nocturne-premium", name: "Nocturne Premium" }, { $set: { name: "PUBLIQ Premium" } },
    );
    console.log(`Updated ${club.modifiedCount} default club name, ${email.modifiedCount} example email, and ${room.modifiedCount} demo room name.`);
    console.log("Custom values, booking data, room slugs and other settings were left unchanged.");
  } finally { await mongoose.disconnect(); }
}
main().catch(() => { console.error("Rebrand update failed; check the local database connection and try again."); process.exitCode = 1; });
