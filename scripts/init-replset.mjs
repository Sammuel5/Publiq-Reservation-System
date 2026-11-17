/**
 * Initialise the local single-node replica set so development matches Atlas
 * (which is a replica set and therefore supports multi-document transactions).
 *
 * Idempotent: safe to run repeatedly.
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/ktv_club?directConnection=true";

try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const admin = mongoose.connection.db.admin();

  try {
    const status = await admin.command({ replSetGetStatus: 1 });
    if (status?.myState === 1) {
      console.log("✓ replica set already primary");
    } else {
      console.log(`• replica set state ${status?.myState} (waiting for election)`);
    }
  } catch (error) {
    if (String(error?.message ?? "").includes("no replset config")) {
      await admin.command({
        replSetInitiate: {
          _id: "rs0",
          members: [{ _id: 0, host: `127.0.0.1:${process.env.MONGO_PORT ?? 27017}` }],
        },
      });
      console.log("✓ replica set rs0 initiated");
      // Give the election a moment, then verify.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const status = await admin.command({ replSetGetStatus: 1 });
      console.log(`✓ replica set primary ready (state ${status.myState})`);
    } else {
      throw error;
    }
  }
} catch (error) {
  console.error("✗ replica set init failed:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => undefined);
}
